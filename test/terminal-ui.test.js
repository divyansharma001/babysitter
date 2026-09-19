import assert from "node:assert/strict";
import test from "node:test";
import { printRoute, printWelcome, renderMarkdown, renderPanel } from "../src/terminal-ui.js";

test("renders common Markdown as clean terminal text", () => {
  const output = renderMarkdown("## Result\n\n- **Fast** route\n- Use `codex`\n\n> Ready", { color: false });
  assert.equal(output, "\nResult\n\n• Fast route\n• Use codex\n\n│ Ready");
});

test("preserves fenced code without Markdown punctuation", () => {
  const output = renderMarkdown("```js\nconst ready = true;\n```", { color: false });
  assert.equal(output, "  js\n  const ready = true;\n");
});

test("sizes the welcome box to long provider names", () => {
  let output = "";
  const stream = { isTTY: false, write(value) { output += value; } };
  printWelcome(stream, "Claude Code");
  const [top, middle, bottom] = output.trimStart().split("\n");
  assert.equal(top.length, middle.length);
  assert.equal(middle.length, bottom.length);
  assert.ok(top.endsWith("╮"));
  assert.ok(middle.endsWith("│"));
  assert.ok(bottom.endsWith("╯"));
});

test("renders closed, aligned panels and wraps long commands", () => {
  const output = renderPanel("PERMISSION · BASH", ["Command: ls -la /a/very/long/path/that/needs/to/wrap cleanly"], { color: false, columns: 52 });
  const lines = output.split("\n");
  assert.ok(lines.length > 3);
  assert.ok(lines[0].endsWith("╮"));
  assert.ok(lines.at(-1).endsWith("╯"));
  assert.ok(lines.slice(1, -1).every((line) => line.endsWith("│")));
  assert.ok(lines.every((line) => line.length === lines[0].length));
});

test("renders a provider-specific route label without leaking the internal tier", () => {
  let output = "";
  const stream = { isTTY: false, write(value) { output += value; } };
  printRoute({
    tier: "astra",
    displayTier: "fable",
    model: "fable",
    effort: "xhigh",
    classifierConfidence: 0.9,
    clarificationProbability: 0.1,
    reasons: ["Fable requires complexity=3 plus high risk or broad scope"],
  }, null, false, stream);
  assert.match(output, /FABLE/);
  assert.doesNotMatch(output, /ASTRA|SOL/);
});
