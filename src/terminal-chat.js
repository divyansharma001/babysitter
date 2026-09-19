import { createInterface } from "node:readline/promises";
import process from "node:process";
import { CodexAppServer } from "./app-server-client.js";
import { classifyPrompt } from "./jev.js";
import { fallbackRoute, routeTask } from "./policy.js";
import { palette, printAnswer, printRoute, printWelcome, startSpinner } from "./terminal-ui.js";

async function selectRoute(prompt) {
  try {
    const classification = await classifyPrompt(prompt);
    return { route: routeTask(classification.signals), usage: classification.usage, fallback: false };
  } catch {
    return { route: fallbackRoute(), usage: null, fallback: true };
  }
}

export async function startTerminalChat({ cwd = process.cwd(), initialPrompt = "" } = {}) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const colors = palette();
  printWelcome();
  const stopStarting = startSpinner("Starting Codex session");
  const client = await CodexAppServer.create(cwd);
  stopStarting();
  process.stdout.write(`${colors.green("✓")} ${colors.dim("Codex session ready")}\n\n`);

  let nextPrompt = initialPrompt;
  try {
    while (true) {
      const prompt = nextPrompt || (await terminal.question(`${colors.bold(colors.cyan("YOU"))} ${colors.dim("❯")} `));
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
