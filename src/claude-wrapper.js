#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { classifyPrompt } from "./jev.js";
import { fallbackRoute, routeTask } from "./policy.js";

function loadLocalEnv() {
  if (process.env.TYPESAFE_API_KEY) return;
  try { process.loadEnvFile?.(); } catch {}
  if (!process.env.TYPESAFE_API_KEY) {
    try { process.loadEnvFile?.(".env"); } catch {}
  }
}

function routeFor(prompt) {
  return classifyPrompt(prompt)
    .then((result) => ({ route: routeTask(result.signals, process.env, "claude"), usage: result.usage, fallback: false }))
    .catch(() => ({ route: fallbackRoute(process.env, "claude"), usage: null, fallback: true }));
}

function runClaude(args, { stream = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: process.cwd(), stdio: ["inherit", "pipe", "inherit"] });
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

async function classify(prompt) {
  loadLocalEnv();
  const result = await routeFor(prompt);
  routeCard(result.route, result.usage, result.fallback);
  return result.route;
}

async function interactive() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let sessionId = process.env.JEV_CLAUDE_SESSION_ID || "";
  try {
    while (true) {
      const prompt = (await rl.question("YOU ❯ ")).trim();
      if (!prompt) continue;
      if (["/exit", "/quit"].includes(prompt)) break;
      const route = await classify(prompt);
      const guarded = route.needsHumanInput ? `${prompt}\n\nIf a missing user decision could materially change the result, ask the user before any irreversible action.` : prompt;
      const args = ["-p", guarded, "--output-format", "json", "--model", route.model, "--effort", route.effort];
      if (sessionId) args.push("--resume", sessionId);
      const raw = await runClaude(args, { stream: false });
      try {
        const result = JSON.parse(raw);
        if (result.session_id) sessionId = result.session_id;
        if (result.result) process.stdout.write(`\n${result.result}\n`);
      } catch {}
    }
  } finally { rl.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) return interactive();
  const printMode = args[0] === "-p" || args[0] === "--print";
  if (!printMode && args[0].startsWith("-")) return runClaude(args);
  const prompt = printMode ? args.slice(1).filter((arg) => !arg.startsWith("-")).join(" ") : args.join(" ");
  if (!prompt) return runClaude(args);
  const route = await classify(prompt);
  const guarded = route.needsHumanInput ? `${prompt}\n\nIf a missing user decision could materially change the result, ask the user before any irreversible action.` : prompt;
  const routed = ["-p", guarded, "--model", route.model, "--effort", route.effort, ...(printMode ? args.slice(1).filter((arg) => arg !== prompt) : [])];
  return runClaude(routed);
}

main().catch((error) => { console.error(`[jev] ${error.message}`); process.exitCode = 1; });
