import { createInterface } from "node:readline/promises";
import process from "node:process";
import { CodexAppServer } from "./app-server-client.js";
import { classifyPrompt } from "./jev.js";
import { fallbackRoute, routeTask } from "./policy.js";
import { palette, printAnswer, printRoute, printSessions, printWelcome, startSpinner } from "./terminal-ui.js";

async function selectRoute(prompt) {
  try {
    const classification = await classifyPrompt(prompt);
    return { route: routeTask(classification.signals), usage: classification.usage, fallback: false };
  } catch {
    return { route: fallbackRoute(), usage: null, fallback: true };
  }
}

export async function startTerminalChat({ cwd = process.cwd(), initialPrompt = "", resumeThreadId = "", chooseResume = false } = {}) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const colors = palette();
  printWelcome();
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

      const stopRouting = startSpinner("Jev is choosing the best model");
      const { route, usage, fallback } = await selectRoute(trimmed);
      stopRouting();
      printRoute(route, usage, fallback);

      const guardedPrompt = route.needsHumanInput
        ? `${trimmed}\n\nIf a missing user decision could materially change the result, ask the user before any irreversible action.`
        : trimmed;
      const stopWorking = startSpinner(`${route.model} is working`);
      const job = await client.startTurn(guardedPrompt, route);
      await job.done;
      stopWorking();
      printAnswer(job.output, job);
    }
  } finally {
    terminal.close();
    client.close();
  }
}
