import assert from "node:assert/strict";
import test from "node:test";
import { fallbackRoute, routeTask } from "../src/policy.js";

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
