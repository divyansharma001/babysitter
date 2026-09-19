#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { handleClaudeInteraction } from "./claude-interaction.js";
import {
  claudePermissionArgs,
  claudePermissionMode,
  hasClaudePermissionOverride,
  isRoutedPermissionMode,
} from "./claude-permissions.js";
import { chooseClaudeSessionRoute, claudeUsage } from "./claude-session-policy.js";
import { classifyPrompt } from "./jev.js";
import { fallbackRoute, routeTask } from "./policy.js";
import { palette, printAnswer, printRoute, printWelcome, startSpinner } from "./terminal-ui.js";

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

function runClaudeNative(real, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(real, args, {
      cwd: process.cwd(),
      env: { ...process.env, JEV_AUTO_CLAUDE_BYPASS: "1" },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Claude exited with ${code}`)));
  });
}

async function runClaudeInteractiveTurn(real, prompt, route, permissionMode, session, rl, onInputStart, onInputEnd) {
  let result;
  const options = {
    cwd: process.cwd(),
    model: route.model,
    permissionMode,
    permissionPrompts: "host",
    pathToClaudeCodeExecutable: real,
    canUseTool: async (toolName, input, context) => {
      onInputStart();
      try {
        return await handleClaudeInteraction(
          toolName,
          input,
          context,
          (question) => rl.question(question),
          (text) => process.stdout.write(text),
        );
      } finally {
        onInputEnd();
      }
    },
  };
  if (!/haiku/i.test(route.model)) options.effort = route.effort;
  if (session.sessionId) options.resume = session.sessionId;
  else if (session.shouldContinue) options.continue = true;

  for await (const message of query({ prompt, options })) {
    if (message.type === "result") result = message;
  }
  if (!result) throw new Error("Claude ended without returning a result");
  if (result.subtype !== "success") {
    throw new Error(result.errors?.join("; ") || `Claude stopped with ${result.subtype}`);
  }
  return result;
}

function printClaudeRoute(route, usage, fallback) {
  // Haiku has no effort control. Show the actual behavior in the card rather
  // than implying that the policy's low-effort value was passed to Claude.
  const visibleRoute = /haiku/i.test(route.model) ? { ...route, effort: "default (Haiku)" } : route;
  printRoute(visibleRoute, usage, fallback);
}

function effortArgs(route) {
  // Claude Haiku does not support Claude's effort control. Let Claude Code use
  // its normal defaults instead of passing an unsupported flag.
  return /haiku/i.test(route.model) ? [] : ["--effort", route.effort];
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

async function selectRoute(prompt) {
  loadLocalEnv();
  return routeFor(prompt);
}

async function interactive(real, { resumeRef = "", continueSession = false, initialPrompt = "" } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const colors = palette();
  let sessionId = resumeRef || process.env.JEV_CLAUDE_SESSION_ID || "";
  let shouldContinue = continueSession && !sessionId;
  let pendingHandoff = "";
  let routingState = { route: null, contextTokens: 0, turnsOnModel: 0 };
  let activePermissionMode = claudePermissionMode();
  let nextPrompt = initialPrompt;
  printWelcome(process.stdout, "Claude Code");
  process.stdout.write(`${colors.green("✓")} ${colors.dim("Claude Code session ready")}\n\n`);
  try {
    while (true) {
      const prompt = (nextPrompt || await rl.question(`${colors.bold(colors.cyan("YOU"))} ${colors.dim("❯")} `)).trim();
      nextPrompt = "";
      if (!prompt) continue;
      if (["/exit", "/quit"].includes(prompt)) break;
      const [command, ...commandArgs] = prompt.split(/\s+/);
      if (command === "/help") {
        process.stdout.write([
          "\nBabysitter commands",
          "  /compact [focus]  create a small handoff and start a fresh routed Claude session",
          "  /status           show the active route, context estimate, and session ID",
          "  /permissions      show or change the routed Claude permission mode",
          "  /new              start a fresh routed session",
          "  /native           open this session in the full Claude Code terminal",
          "  /rc [name]        open this session with Claude Remote Control",
          "  /exit             leave Babysitter",
          "\nUse /native for any official Claude Code slash command not listed here.\n\n",
        ].join("\n"));
        continue;
      }
      if (command === "/permissions") {
        const requested = commandArgs[0];
        if (!requested) {
          process.stdout.write(`\nPermission  ${activePermissionMode}\nOptions     acceptEdits, plan, dontAsk, auto\n\n`);
          continue;
        }
        if (!isRoutedPermissionMode(requested)) {
          process.stdout.write(`${colors.yellow("!")} ${colors.dim("Choose acceptEdits, plan, dontAsk, or auto. Use /native when you want Claude Code's interactive approval UI.")}\n\n`);
          continue;
        }
        activePermissionMode = requested;
        const note = requested === "auto" ? " (availability depends on your Claude account)" : "";
        process.stdout.write(`${colors.green("✓")} ${colors.dim(`Permission mode set to ${requested}${note}`)}\n\n`);
        continue;
      }
      if (command === "/status") {
        process.stdout.write(`\nSession     ${sessionId || "new"}\nModel       ${routingState.route?.model || "not selected"}\nEffort      ${routingState.route?.effort || "not selected"}\nPermission  ${activePermissionMode}\nContext     ~${routingState.contextTokens.toLocaleString()} tokens\n\n`);
        continue;
      }
      if (["/new", "/clear"].includes(command)) {
        sessionId = "";
        shouldContinue = false;
        pendingHandoff = "";
        routingState = { route: null, contextTokens: 0, turnsOnModel: 0 };
        process.stdout.write(`${colors.green("✓")} ${colors.dim("Started a fresh routed Claude session")}\n\n`);
        continue;
      }
      if (command === "/native" || command === "/rc") {
        const nativeArgs = [];
        if (sessionId) nativeArgs.push("--resume", sessionId);
        if (command === "/rc") nativeArgs.push("--remote-control", ...commandArgs);
        process.stdout.write(`${colors.yellow("↗")} ${colors.dim(`Opening native Claude Code${command === "/rc" ? " Remote Control" : ""}; automatic routing pauses until you return.`)}\n`);
        await runClaudeNative(real, nativeArgs);
        process.stdout.write(`${colors.green("✓")} ${colors.dim("Returned to Babysitter routing")}\n\n`);
        continue;
      }
      if (command === "/compact") {
        if (!sessionId || !routingState.route) {
          process.stdout.write(`${colors.yellow("!")} ${colors.dim("There is no active Claude conversation to compact.")}\n\n`);
          continue;
        }
        const focus = commandArgs.join(" ");
        const compactPrompt = [
          "Create a compact handoff for a fresh Claude Code session.",
          "Preserve the goal, decisions, constraints, relevant files and symbols, changes already made, verification results, unresolved issues, and exact next steps.",
          "Do not include conversational filler. Return only the handoff.",
          focus ? `Give special attention to: ${focus}` : "",
        ].filter(Boolean).join("\n");
        const compactArgs = ["-p", compactPrompt, "--output-format", "json", "--model", routingState.route.model, ...effortArgs(routingState.route), ...claudePermissionArgs(activePermissionMode), "--resume", sessionId];
        const stopCompact = startSpinner("Claude is creating a compact handoff");
        let compactRaw;
        try {
          compactRaw = await runClaude(real, compactArgs, { stream: false });
        } finally {
          stopCompact();
        }
        const compactResult = JSON.parse(compactRaw);
        pendingHandoff = compactResult.result || "";
        sessionId = "";
        shouldContinue = false;
        routingState = { route: null, contextTokens: Math.ceil(pendingHandoff.length / 4), turnsOnModel: 0 };
        process.stdout.write(`${colors.green("✓")} ${colors.dim(`Compacted to an approximately ${routingState.contextTokens.toLocaleString()}-token handoff; the next prompt starts a fresh routed session.`)}\n\n`);
        continue;
      }
      if (command.startsWith("/")) {
        process.stdout.write(`${colors.yellow("!")} ${colors.dim(`Babysitter does not emulate ${command}. Use /native to open the official Claude Code terminal without losing this session.`)}\n\n`);
        continue;
      }
      const stopRouting = startSpinner("Jev is choosing the best model");
      const { route: candidate, usage, fallback } = await selectRoute(prompt);
      const decision = chooseClaudeSessionRoute(candidate, routingState, process.env);
      const { route } = decision;
      stopRouting();
      printClaudeRoute(route, usage, fallback);
      const guarded = route.needsHumanInput ? `${prompt}\n\nIf a missing user decision could materially change the result, ask the user before any irreversible action.` : prompt;
      const routedPrompt = pendingHandoff
        ? `Context handoff from the previous compacted session:\n\n${pendingHandoff}\n\nNew request:\n${guarded}`
        : guarded;
      const startedAt = new Date().toISOString();
      let stopWorking = startSpinner(`${route.model} is thinking`);
      let completedAt;
      let result;
      let turnError;
      try {
        result = await runClaudeInteractiveTurn(
          real,
          routedPrompt,
          route,
          activePermissionMode,
          { sessionId, shouldContinue },
          rl,
          () => {
            stopWorking?.();
            stopWorking = null;
          },
          () => {
            stopWorking = startSpinner(`${route.model} is continuing`);
          },
        );
        completedAt = new Date().toISOString();
      } catch (error) {
        turnError = error;
      } finally {
        stopWorking?.();
      }
      if (turnError) {
        process.stdout.write(`${colors.yellow("!")} ${colors.dim(turnError.message)}\n\n`);
        continue;
      }
      try {
        if (result.session_id) {
          sessionId = result.session_id;
          shouldContinue = false;
        }
        pendingHandoff = "";
        const stats = claudeUsage(result);
        routingState = {
          route,
          contextTokens: stats.contextTokens || routingState.contextTokens,
          turnsOnModel: decision.switched ? 1 : routingState.turnsOnModel + 1,
        };
        if (result.result) printAnswer(result.result, {
          status: "complete", model: route.model, startedAt, completedAt,
        }, process.stdout, "CLAUDE");
        const cost = stats.costUsd == null ? "" : ` · $${stats.costUsd.toFixed(4)}`;
        process.stdout.write(`${colors.dim(`  Usage · ${stats.input.toLocaleString()} new · ${stats.cacheRead.toLocaleString()} cache read · ${stats.cacheWrite.toLocaleString()} cache write · ${stats.output.toLocaleString()} output${cost}`)}\n`);
        if (sessionId) process.stdout.write(`${colors.dim(`  Session · ${sessionId}`)}\n\n`);
      } catch (error) {
        process.stdout.write(`${colors.yellow("!")} ${colors.dim(error.message)}\n\n`);
      }
    }
  } finally { rl.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const real = realClaude();
  if (!real) throw new Error("Could not locate the official Claude Code executable. Set JEV_AUTO_REAL_CLAUDE to its full path.");
  if (process.env.JEV_AUTO_CLAUDE_BYPASS === "1") return runClaude(real, args);
  if (["resume", "-r", "--resume"].includes(args[0])) {
    const resumeRef = args[1]?.trim() || "";
    if (!resumeRef) {
      console.error("[babysitter] Opening Claude Code's session picker. This is browse-only; pass an ID or name to keep automatic routing.");
      return runClaude(real, ["--resume"]);
    }
    return interactive(real, { resumeRef, initialPrompt: args.slice(2).join(" ") });
  }
  if (["continue", "-c", "--continue"].includes(args[0])) {
    const initialPrompt = args.slice(1).filter((arg) => !["-p", "--print"].includes(arg)).join(" ");
    return interactive(real, { continueSession: true, initialPrompt });
  }
  if (args[0] === "sessions") {
    console.error("[babysitter] Opening Claude Code's session picker. This is browse-only; use `bbs-claude resume <session-id-or-name>` to resume a selected session with routing.");
    return runClaude(real, ["--resume"]);
  }
  if (!args.length) return interactive(real);

  if (
    PASSTHROUGH.has(args[0]) ||
    args.some((arg) => ["--help", "-h", "--version", "-v"].includes(arg)) ||
    args.includes("--model")
  ) return runClaude(real, args);

  const printMode = args[0] === "-p" || args[0] === "--print";
  if (!printMode && args[0].startsWith("-")) return runClaude(real, args);
  if (!printMode) return interactive(real, { initialPrompt: args.join(" ") });
  const parsed = printMode ? printInvocation(args) : { prompt: args.join(" "), forwarded: [] };
  const { prompt } = parsed;
  if (!prompt) return runClaude(real, args);
  const result = await selectRoute(prompt);
  printClaudeRoute(result.route, result.usage, result.fallback);
  const { route } = result;
  const guarded = route.needsHumanInput ? `${prompt}\n\nIf a missing user decision could materially change the result, ask the user before any irreversible action.` : prompt;
  const permissionArgs = hasClaudePermissionOverride(parsed.forwarded)
    ? []
    : claudePermissionArgs(claudePermissionMode());
  const routed = ["-p", guarded, "--model", route.model, ...effortArgs(route), ...permissionArgs, ...parsed.forwarded];
  return runClaude(real, routed);
}

main().catch((error) => { console.error(`[jev] ${error.message}`); process.exitCode = 1; });
