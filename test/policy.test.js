import assert from "node:assert/strict";
import test from "node:test";
import { fallbackRoute, routeTask } from "../src/policy.js";
import { chooseClaudeSessionRoute, claudeUsage } from "../src/claude-session-policy.js";
import {
  claudePermissionArgs,
  claudePermissionMode,
  hasClaudePermissionOverride,
  isRoutedPermissionMode,
} from "../src/claude-permissions.js";
import { answerClaudeQuestion, describeClaudeTool, handleClaudeInteraction } from "../src/claude-interaction.js";

function signals(overrides = {}) {
  return {
    complexity: { score: 1, confidence: 0.9 },
    risk: { score: 0, confidence: 0.9 },
    breadth: { score: 0, confidence: 0.9 },
    taskType: { choice: "implementation", confidence: 0.9 },
    needsClarification: { noul: 0.1 },
    ...overrides,
  };
}

test("routes routine work to Terra", () => {
  const route = routeTask(signals());
  assert.equal(route.tier, "terra");
  assert.equal(route.effort, "medium");
});

test("routes clear repeatable work to Luna", () => {
  const route = routeTask(signals({ complexity: { score: 0, confidence: 0.9 } }));
  assert.equal(route.tier, "luna");
  assert.equal(route.effort, "low");
});

test("promotes high-risk work to Sol", () => {
  const route = routeTask(signals({ risk: { score: 2.2, confidence: 0.9 } }));
  assert.equal(route.tier, "sol");
  assert.equal(route.effort, "high");
});

test("does not spend more solely because router confidence is low", () => {
  const route = routeTask(signals({ complexity: { score: 0, confidence: 0.2 } }));
  assert.equal(route.tier, "luna");
  assert.match(route.reasons.join(" "), /tier not increased/);
});

test("does not promote a simple research prompt", () => {
  const route = routeTask(signals({
    taskType: { choice: "architecture_or_research", confidence: 0.14 },
  }));
  assert.equal(route.tier, "terra");
});

test("caps isolated complexity-three work at Sol", () => {
  const route = routeTask(signals({ complexity: { score: 3, confidence: 0.9 } }));
  assert.equal(route.tier, "sol");
  assert.equal(route.effort, "xhigh");
});

test("uses Astra only for hardest broad or high-risk work", () => {
  const route = routeTask(signals({
    complexity: { score: 3, confidence: 0.9 },
    breadth: { score: 2, confidence: 0.9 },
  }));
  assert.equal(route.tier, "astra");
  assert.equal(route.effort, "xhigh");
});

test("flags prompts that need a material user decision", () => {
  const route = routeTask(signals({ needsClarification: { noul: 0.91 } }));
  assert.equal(route.needsHumanInput, true);
});

test("uses a conservative fallback when Jev is unavailable", () => {
  const route = fallbackRoute();
  assert.equal(route.tier, "terra");
  assert.equal(route.effort, "medium");
});

test("maps routing tiers to Claude model aliases", () => {
  assert.equal(routeTask(signals({ complexity: { score: 0, confidence: 0.9 } }), {}, "claude").model, "haiku");
  assert.equal(routeTask(signals(), {}, "claude").model, "sonnet");
  assert.equal(routeTask(signals({ complexity: { score: 2, confidence: 0.9 } }), {}, "claude").model, "opus");
});

test("keeps a warm Claude model instead of downgrading a long session", () => {
  const current = routeTask(signals({ complexity: { score: 2, confidence: 0.9 } }), {}, "claude");
  const candidate = routeTask(signals({ complexity: { score: 1, confidence: 0.9 } }), {}, "claude");
  const decision = chooseClaudeSessionRoute(candidate, {
    route: current,
    contextTokens: 20_000,
    turnsOnModel: 5,
  }, {});
  assert.equal(decision.route.model, "opus");
  assert.equal(decision.switched, false);
  assert.match(decision.route.reasons.at(-1), /avoid reloading/);
});

test("allows Claude quality upgrades despite a large context", () => {
  const current = routeTask(signals({ complexity: { score: 1, confidence: 0.9 } }), {}, "claude");
  const candidate = routeTask(signals({
    complexity: { score: 3, confidence: 0.9 },
    breadth: { score: 2, confidence: 0.9 },
  }), {}, "claude");
  const decision = chooseClaudeSessionRoute(candidate, {
    route: current,
    contextTokens: 20_000,
    turnsOnModel: 5,
  }, {});
  assert.equal(decision.route.model, "opus");
  assert.equal(decision.switched, true);
});

test("summarizes Claude cache usage", () => {
  assert.deepEqual(claudeUsage({
    total_cost_usd: 0.12,
    usage: {
      input_tokens: 100,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 50,
      output_tokens: 25,
    },
  }), { input: 100, cacheRead: 900, cacheWrite: 50, output: 25, contextTokens: 1050, costUsd: 0.12 });
});

test("uses safe file-edit permissions for routed Claude sessions", () => {
  assert.equal(claudePermissionMode({}), "acceptEdits");
  assert.deepEqual(claudePermissionArgs(), ["--permission-mode", "acceptEdits", "--permission-prompts", "none"]);
});

test("rejects unsafe or unknown routed Claude permission modes", () => {
  assert.equal(claudePermissionMode({ JEV_AUTO_CLAUDE_PERMISSION_MODE: "bypassPermissions" }), "acceptEdits");
  assert.equal(isRoutedPermissionMode("plan"), true);
  assert.equal(isRoutedPermissionMode("bypassPermissions"), false);
});

test("detects explicit Claude permission flags", () => {
  assert.equal(hasClaudePermissionOverride(["--permission-mode=plan"]), true);
  assert.equal(hasClaudePermissionOverride(["--permission-prompts", "host"]), true);
  assert.equal(hasClaudePermissionOverride(["--model", "sonnet"]), false);
});

test("maps Claude question numbers back to option labels", () => {
  const question = {
    question: "Which stack?",
    options: [{ label: "React" }, { label: "Vue" }],
    multiSelect: false,
  };
  assert.equal(answerClaudeQuestion(question, "2"), "Vue");
  assert.equal(answerClaudeQuestion({ ...question, multiSelect: true }, "1, 2"), "React, Vue");
  assert.equal(answerClaudeQuestion(question, "Svelte"), "Svelte");
});

test("formats permission requests without dumping file contents", () => {
  assert.match(describeClaudeTool("Bash", { command: "npm test", description: "Run tests" }), /npm test/);
  assert.equal(describeClaudeTool("Write", { file_path: "/tmp/a", content: "secret" }), "Claude wants to use Write\nPath: /tmp/a");
});

test("returns Claude clarification answers in the same tool request", async () => {
  const writes = [];
  const result = await handleClaudeInteraction("AskUserQuestion", {
    questions: [{ question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }], multiSelect: false }],
  }, {}, async () => "1", (value) => writes.push(value));
  assert.equal(result.behavior, "allow");
  assert.equal(result.updatedInput.answers["Which database?"], "Postgres");
  assert.match(writes.join(""), /Which database/);
});
