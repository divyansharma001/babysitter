#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { classifyPrompt } from "./jev.js";
import { fallbackRoute, routeTask } from "./policy.js";
import { startTerminalChat } from "./terminal-chat.js";
import { printSessions } from "./terminal-ui.js";

const wrapperPath = fileURLToPath(import.meta.url);
const PASSTHROUGH = new Set(["agents", "login", "logout", "mcp", "plugin", "app", "completion", "update", "doctor", "sandbox", "debug", "apply", "archive", "delete", "migrate-rollouts", "unarchive", "fork", "queue", "cloud", "app-server", "exec-server", "features", "help", "review"]);

function loadLocalEnv() {
  if (process.env.TYPESAFE_API_KEY) return;
  for (const file of [undefined, fileURLToPath(new URL("../.env", import.meta.url))]) {
    try { process.loadEnvFile?.(file); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    if (process.env.TYPESAFE_API_KEY) return;
  }
}

function realCodex() {
  if (process.env.JEV_AUTO_REAL_CODEX && existsSync(process.env.JEV_AUTO_REAL_CODEX)) return process.env.JEV_AUTO_REAL_CODEX;
  const candidates = ["/Applications/ChatGPT.app/Contents/Resources/codex"];
  try { candidates.push(...execFileSync("which", ["-a", "codex"], { encoding: "utf8" }).trim().split("\n")); } catch {}
  return candidates.find((candidate) => candidate && candidate !== wrapperPath && existsSync(candidate));
}

function run(real, args) {
  const child = spawn(real, args, { cwd: process.cwd(), env: { ...process.env, JEV_AUTO_BYPASS: "1" }, stdio: "inherit" });
  child.on("error", (error) => { console.error(`[auto] Could not start Codex: ${error.message}`); process.exitCode = 1; });
  child.on("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
}

function taskFromArgs(args) {
  if (args[0] === "exec") return args.at(-1)?.startsWith("-") ? "" : args.at(-1) || "";
  if (PASSTHROUGH.has(args[0]) || args.includes("--help") || args.includes("-h") || args.includes("--version") || args.includes("-V")) return "";
  if (args.includes("--model") || args.includes("-m")) return "";
  return args.filter((arg) => !arg.startsWith("-")).at(-1) || "";
}

async function main() {
  const args = process.argv.slice(2);
  const real = realCodex();
  if (!real) throw new Error("Could not locate the real Codex executable. Set JEV_AUTO_REAL_CODEX to its full path.");
  if (process.env.JEV_AUTO_BYPASS === "1") return run(real, args);

  if (args[0] === "sessions") {
    const { CodexAppServer } = await import("./app-server-client.js");
    printSessions(await CodexAppServer.listThreads(process.cwd()));
    return;
  }

  if (args[0] === "resume") {
    loadLocalEnv();
    const threadId = args[1] === "--last" ? "" : args[1] || "";
    await startTerminalChat({ cwd: process.cwd(), resumeThreadId: threadId, chooseResume: !threadId });
    return;
  }

  if (args.length === 0) {
    loadLocalEnv();
    await startTerminalChat({ cwd: process.cwd() });
    return;
  }

  let task = taskFromArgs(args);
  if (!task) return run(real, args);

  if (args[0] !== "exec") {
    loadLocalEnv();
    await startTerminalChat({ cwd: process.cwd(), initialPrompt: task });
    return;
  }

  loadLocalEnv();
  let classification;
  let route;
  try { classification = await classifyPrompt(task); route = routeTask(classification.signals); }
  catch { route = fallbackRoute(); }

  console.error(`[auto] ${route.model} · ${route.effort}`);
  const guardedTask = route.needsHumanInput
    ? `${task}\n\nIf a missing user decision could materially change the work, ask before any irreversible action.`
    : task;
  const routedArgs = args[0] === "exec"
    ? ["exec", "-m", route.model, "-c", `model_reasoning_effort=\"${route.effort}\"`, ...args.slice(1, -1), guardedTask]
    : ["-m", route.model, "-c", `model_reasoning_effort=\"${route.effort}\"`, ...args.filter((arg) => arg !== task), guardedTask];
  run(real, routedArgs);
}

main().catch((error) => { console.error(`[auto] ${error.message}`); process.exitCode = 1; });
