import { createInterface } from "node:readline/promises";
import process from "node:process";
import { CodexAppServer } from "./app-server-client.js";
import { classifyPrompt } from "./jev.js";
import { fallbackRoute, routeTask } from "./policy.js";
import { palette, printAnswer, printRoute, printSessions, printWelcome, startSpinner } from "./terminal-ui.js";
import { checkForBabysitterUpdate, updateNotice } from "./update.js";
import { captureClipboardImage, resolveImagePath } from "./image-input.js";

async function selectRoute(prompt) {
  try {
    const classification = await classifyPrompt(prompt);
    return { route: routeTask(classification.signals), usage: classification.usage, fallback: false };
  } catch {
    return { route: fallbackRoute(), usage: null, fallback: true };
  }
}

export async function startTerminalChat({ cwd = process.cwd(), initialPrompt = "", resumeThreadId = "", chooseResume = false, nativeLauncher = null } = {}) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const colors = palette();
  printWelcome();
  const availableUpdate = await checkForBabysitterUpdate();
  if (availableUpdate) process.stdout.write(`${colors.yellow("↑")} ${colors.bold(updateNotice(availableUpdate))}\n\n`);
  let selectedThreadId = resumeThreadId;
  if (chooseResume) {
    const stopListing = startSpinner("Finding saved Codex sessions");
    const threads = await CodexAppServer.listThreads(cwd);
    stopListing();
    printSessions(threads);
    if (!threads.length) {
      terminal.close();
      return;
    }
    const answer = (await terminal.question(`${colors.bold(colors.cyan("RESUME"))} ${colors.dim("❯ Enter number or session ID: ")} `)).trim();
    const number = Number(answer);
    selectedThreadId = Number.isInteger(number) && number >= 1 && number <= threads.length
      ? threads[number - 1].id
      : answer;
    if (!selectedThreadId) {
      terminal.close();
      return;
    }
  }
  const stopStarting = startSpinner(selectedThreadId ? "Resuming Codex session" : "Starting Codex session");
  const client = selectedThreadId
    ? await CodexAppServer.resume(cwd, selectedThreadId)
    : await CodexAppServer.create(cwd);
  stopStarting();
  process.stdout.write(`${colors.green("✓")} ${colors.dim(selectedThreadId ? `Resumed Codex session · ${client.threadId}` : "Codex session ready")}\n\n`);

  let nextPrompt = initialPrompt;
  let pendingImages = [];
  try {
    while (true) {
      let prompt;
      try {
        prompt = nextPrompt || (await terminal.question(`${colors.bold(colors.cyan("YOU"))} ${colors.dim("❯")} `));
      } catch (error) {
        if (error?.code === "ERR_USE_AFTER_CLOSE") break;
        throw error;
      }
      nextPrompt = "";
      const trimmed = prompt.trim();
      if (!trimmed) continue;
      if (trimmed === "/exit" || trimmed === "/quit") break;
      const [command] = trimmed.split(/\s+/);
      if (command === "/help") {
        process.stdout.write([
          "\nBabysitter commands",
          "  /compact  compact this Codex thread using the official app-server operation",
          "  /status   show the active thread ID",
          "  /paste    attach the image currently on the macOS clipboard",
          "  /image    attach an image file: /image <path>",
          "  /native   hand this thread to the full Codex terminal",
          "  /exit     leave Babysitter",
          "\nUse /native for official Codex slash commands not listed here.\n\n",
        ].join("\n"));
        continue;
      }
      if (command === "/status") {
        process.stdout.write(`\nThread      ${client.threadId}\nProvider    Codex\nRouting     automatic per prompt\nAttachments ${pendingImages.length}\n\n`);
        continue;
      }
      if (command === "/paste" || command === "/image") {
        try {
          const path = command === "/paste"
            ? captureClipboardImage(cwd)
            : resolveImagePath(trimmed.slice(command.length), cwd);
          pendingImages.push(path);
          process.stdout.write(`${colors.green("✓")} ${colors.dim(`Attached image ${pendingImages.length}: ${path}`)}\n${colors.dim("  Type the prompt that should use it.")}\n\n`);
        } catch (error) {
          process.stdout.write(`${colors.yellow("!")} ${colors.dim(error.message)}\n\n`);
        }
        continue;
      }
      if (command === "/compact") {
        const stopCompact = startSpinner("Codex is compacting this thread");
        try {
          await client.compact();
        } finally {
          stopCompact();
        }
        process.stdout.write(`${colors.green("✓")} ${colors.dim("Codex thread compacted")}\n\n`);
        continue;
      }
      if (command === "/native") {
        if (!nativeLauncher) {
          process.stdout.write(`${colors.yellow("!")} ${colors.dim(`Run codex resume ${client.threadId} to open the native terminal.`)}\n\n`);
          continue;
        }
        process.stdout.write(`${colors.yellow("↗")} ${colors.dim("Handing this thread to native Codex; automatic routing pauses.")}\n`);
        client.close();
        terminal.close();
        await nativeLauncher(client.threadId);
        return;
      }
      if (command.startsWith("/")) {
        process.stdout.write(`${colors.yellow("!")} ${colors.dim(`Babysitter does not emulate ${command}. Use /native to continue this thread in the official Codex terminal.`)}\n\n`);
        continue;
      }

      const stopRouting = startSpinner("Jev is choosing the best model");
      const routingPrompt = pendingImages.length
        ? `${trimmed}\n\nThis request includes ${pendingImages.length} image attachment${pendingImages.length === 1 ? "" : "s"} for visual analysis.`
        : trimmed;
      const { route, usage, fallback } = await selectRoute(routingPrompt);
      stopRouting();
      printRoute(route, usage, fallback);

      const guardedPrompt = route.needsHumanInput
        ? `${trimmed}\n\nIf a missing user decision could materially change the result, ask the user before any irreversible action.`
        : trimmed;
      const stopWorking = startSpinner(`${route.model} is working`);
      const turnImages = pendingImages;
      pendingImages = [];
      try {
        const job = await client.startTurn(guardedPrompt, route, turnImages);
        await job.done;
        stopWorking();
        printAnswer(job.output, job);
      } catch (error) {
        stopWorking();
        pendingImages.unshift(...turnImages);
        process.stdout.write(`${colors.red("!")} ${colors.dim(error.message)}\n${colors.dim("  Attached images were kept for your next attempt.")}\n\n`);
      }
    }
  } finally {
    terminal.close();
    client.close();
  }
}
