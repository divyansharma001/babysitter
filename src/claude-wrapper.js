#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { classifyPrompt } from "./jev.js";
import { fallbackRoute, routeTask } from "./policy.js";

const wrapperPath = realpathSync(fileURLToPath(import.meta.url));
const PASSTHROUGH = new Set([
  "agents", "attach", "auth", "auto-mode", "daemon", "doctor", "gateway",
  "import", "install", "kill", "logs", "mcp", "plugin", "plugins", "project",
  "remote-control", "respawn", "rm", "self-hosted-runner", "setup-token", "stop",
  "ultrareview", "update",
]);
const FLAGS_WITH_VALUE = new Set([
  "--add-dir", "--agent", "--agents", "--allowedTools", "--allowed-tools",
  "--append-system-prompt", "--autocompact", "--betas", "--debug", "-d",
  "--debug-file", "--disallowedTools", "--disallowed-tools", "--effort",
  "--environment", "--fallback-model", "--file", "--from-pr", "--input-format",
  "--json-schema", "--max-budget-usd", "--mcp-config", "--model", "--name", "-n",
  "--output-format", "--permission-mode", "--permission-prompts", "--plugin-dir",
  "--plugin-url", "--remote-control-session-name-prefix", "--resume", "-r",
  "--session-id", "--setting-sources", "--settings", "--system-prompt", "--tools",
]);

function loadLocalEnv() {
  if (process.env.TYPESAFE_API_KEY) return;
  for (const file of [undefined, fileURLToPath(new URL("../.env", import.meta.url))]) {
    try { process.loadEnvFile?.(file); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    if (process.env.TYPESAFE_API_KEY) return;
  }
}

function realClaude() {
  if (process.env.JEV_AUTO_REAL_CLAUDE && existsSync(process.env.JEV_AUTO_REAL_CLAUDE)) {
    return process.env.JEV_AUTO_REAL_CLAUDE;
  }

  const candidates = [];
  if (process.env.HOME) candidates.push(`${process.env.HOME}/.local/bin/claude`);
  try { candidates.push(...execFileSync("which", ["-a", "claude"], { encoding: "utf8" }).trim().split("\n")); } catch {}

  return candidates.find((candidate) => {
    if (!candidate || !existsSync(candidate)) return false;
    try { return realpathSync(candidate) !== wrapperPath; } catch { return false; }
  });
}

function routeFor(prompt) {
  return classifyPrompt(prompt)
    .then((result) => ({ route: routeTask(result.signals, process.env, "claude"), usage: result.usage, fallback: false }))
    .catch(() => ({ route: fallbackRoute(process.env, "claude"), usage: null, fallback: true }));
}

function runClaude(real, args, { stream = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(real, args, {
      cwd: process.cwd(),
      env: { ...process.env, JEV_AUTO_CLAUDE_BYPASS: "1" },
      stdio: ["inherit", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; if (stream) process.stdout.write(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`Claude exited with ${code}`)));
  });
}

function routeCard(route, usage, fallback) {
  const reason = route.reasons.join("; ");
  const tokens = usage?.input_tokens ? ` · ${usage.input_tokens} Jev input tokens` : "";
  process.stderr.write(`[jev] ${route.tier.toUpperCase()} · ${route.model} · ${route.effort} · ${reason}${fallback ? " · fallback" : ""}${tokens}\n`);
}

function printInvocation(args) {
  const forwarded = [];
  let prompt = "";
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--") && arg.includes("=")) {
      forwarded.push(arg);
      continue;
    }
    if (FLAGS_WITH_VALUE.has(arg)) {
      forwarded.push(arg);
      if (args[index + 1] !== undefined) forwarded.push(args[++index]);
      continue;
    }
    if (arg.startsWith("-")) {
      forwarded.push(arg);
      continue;
    }
    if (!prompt) prompt = arg;
    else forwarded.push(arg);
  }
  return { prompt, forwarded };
}

async function classify(prompt) {
  loadLocalEnv();
  const result = await routeFor(prompt);
  routeCard(result.route, result.usage, result.fallback);
  return result.route;
}

async function interactive(real) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let sessionId = process.env.JEV_CLAUDE_SESSION_ID || "";
  process.stdout.write("\nBabysitter · Claude Code — every prompt gets a fresh model choice. Type /exit to quit.\n\n");
  try {
    while (true) {
      const prompt = (await rl.question("YOU ❯ ")).trim();
      if (!prompt) continue;
      if (["/exit", "/quit"].includes(prompt)) break;
      const route = await classify(prompt);
      const guarded = route.needsHumanInput ? `${prompt}\n\nIf a missing user decision could materially change the result, ask the user before any irreversible action.` : prompt;
      const args = ["-p", guarded, "--output-format", "json", "--model", route.model, "--effort", route.effort];
      if (sessionId) args.push("--resume", sessionId);
      const raw = await runClaude(real, args, { stream: false });
      try {
        const result = JSON.parse(raw);
        if (result.session_id) sessionId = result.session_id;
        if (result.result) process.stdout.write(`\n${result.result}\n`);
      } catch {
        process.stdout.write(raw);
      }
    }
  } finally { rl.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const real = realClaude();
  if (!real) throw new Error("Could not locate the official Claude Code executable. Set JEV_AUTO_REAL_CLAUDE to its full path.");
  if (process.env.JEV_AUTO_CLAUDE_BYPASS === "1") return runClaude(real, args);
  if (!args.length) return interactive(real);

  if (
    PASSTHROUGH.has(args[0]) ||
    args.some((arg) => ["--help", "-h", "--version", "-v"].includes(arg)) ||
    args.includes("--model")
  ) return runClaude(real, args);

  const printMode = args[0] === "-p" || args[0] === "--print";
  if (!printMode && args[0].startsWith("-")) return runClaude(real, args);
  const parsed = printMode ? printInvocation(args) : { prompt: args.join(" "), forwarded: [] };
  const { prompt } = parsed;
  if (!prompt) return runClaude(real, args);
  const route = await classify(prompt);
  const guarded = route.needsHumanInput ? `${prompt}\n\nIf a missing user decision could materially change the result, ask the user before any irreversible action.` : prompt;
  const routed = ["-p", guarded, "--model", route.model, "--effort", route.effort, ...parsed.forwarded];
  return runClaude(real, routed);
}

main().catch((error) => { console.error(`[jev] ${error.message}`); process.exitCode = 1; });
