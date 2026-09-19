import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../src/terminal-ui.js";

test("renders common Markdown as clean terminal text", () => {
  const output = renderMarkdown("## Result\n\n- **Fast** route\n- Use `codex`\n\n> Ready", { color: false });
  assert.equal(output, "\nResult\n\n• Fast route\n• Use codex\n\n│ Ready");
});

test("preserves fenced code without Markdown punctuation", () => {
  const output = renderMarkdown("```js\nconst ready = true;\n```", { color: false });
  assert.equal(output, "  js\n  const ready = true;\n");
});
