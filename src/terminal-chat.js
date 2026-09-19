import { createInterface } from "node:readline/promises";
import process from "node:process";
import { CodexAppServer } from "./app-server-client.js";
import { classifyPrompt } from "./jev.js";
import { fallbackRoute, routeTask } from "./policy.js";

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
  console.log("\nAuto Codex — every prompt is routed by Jev. Type /exit to quit.\n");
  process.stdout.write("Starting Codex session…");
  const client = await CodexAppServer.create(cwd);
  process.stdout.write(" ready.\n\n");

  let nextPrompt = initialPrompt;
  try {
    while (true) {
      const prompt = nextPrompt || (await terminal.question("You › "));
      nextPrompt = "";
      const trimmed = prompt.trim();
      if (!trimmed) continue;
      if (trimmed === "/exit" || trimmed === "/quit") break;

      process.stdout.write("Routing…");
      const { route, usage, fallback } = await selectRoute(trimmed);
      const routerTokens = usage?.input_tokens;
      const usageText = routerTokens ? ` · Jev ${routerTokens} input tokens` : "";
      process.stdout.write(`\r[auto] ${route.model} · ${route.effort}${usageText}${fallback ? " · fallback" : ""}\n\nCodex › `);

      const guardedPrompt = route.needsHumanInput
        ? `${trimmed}\n\nIf a missing user decision could materially change the result, ask the user before any irreversible action.`
        : trimmed;
      const stopStreaming = client.onText((text) => process.stdout.write(text));
      const job = await client.startTurn(guardedPrompt, route);
      await job.done;
      stopStreaming();
      process.stdout.write(`\n\n[${job.status} · ${route.model}]\n\n`);
    }
  } finally {
    terminal.close();
    client.close();
  }
}
