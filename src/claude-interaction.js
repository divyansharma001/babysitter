import process from "node:process";
import { hasColor, palette, renderPanel } from "./terminal-ui.js";

function choiceFromInput(question, raw) {
  const choices = Array.isArray(question.options) ? question.options : [];
  const selected = raw.split(",").map((value) => value.trim()).filter(Boolean).map((value) => {
    const index = Number.parseInt(value, 10);
    return Number.isInteger(index) && index >= 1 && index <= choices.length
      ? choices[index - 1].label
      : value;
  });
  return question.multiSelect ? selected.join(", ") : (selected[0] || "");
}

export function answerClaudeQuestion(question, raw) {
  return choiceFromInput(question, raw);
}

export function describeClaudeTool(toolName, input, options = {}) {
  const lines = [];
  if (options.title) lines.push(options.title);
  else lines.push(`Claude wants to use ${toolName}`);
  if (options.description) lines.push(options.description);

  if (toolName === "Bash") {
    if (input.command) lines.push(`Command: ${input.command}`);
    if (input.description) lines.push(`Purpose: ${input.description}`);
  } else if (["Write", "Edit", "Read", "NotebookEdit"].includes(toolName)) {
    const path = input.file_path || input.notebook_path;
    if (path) lines.push(`Path: ${path}`);
  } else {
    const preview = JSON.stringify(input, null, 2);
    lines.push(preview.length > 1200 ? `${preview.slice(0, 1200)}\n…` : preview);
  }
  return lines.filter(Boolean).join("\n");
}

export async function handleClaudeInteraction(toolName, input, options, ask, write) {
  const color = hasColor(process.stdout);
  const colors = palette(color);
  if (toolName === "AskUserQuestion") {
    const answers = {};
    const questions = input.questions || [];
    for (const [questionIndex, question] of questions.entries()) {
      const lines = [question.question, ""];
      for (const [index, option] of (question.options || []).entries()) {
        lines.push(`${index + 1}. ${option.label}`);
        if (option.description) lines.push(`   ${option.description}`);
      }
      const title = `QUESTION ${questionIndex + 1}/${questions.length}${question.header ? ` · ${String(question.header).toUpperCase()}` : ""}`;
      write(`\n${renderPanel(title, lines, { color })}\n`);
      const suffix = question.multiSelect ? "numbers separated by commas, or a custom answer" : "a number, or a custom answer";
      const raw = await ask(`  ${colors.bold(colors.cyan("ANSWER"))} ${colors.dim(`(${suffix})`)} ${colors.cyan("❯")} `);
      answers[question.question] = answerClaudeQuestion(question, raw);
    }
    return { behavior: "allow", updatedInput: { ...input, answers } };
  }

  const canRemember = !options.suppressAlwaysAllowRule && (options.suggestions || []).some((suggestion) => suggestion.destination === "localSettings");
  const details = describeClaudeTool(toolName, input, options).split("\n");
  if (!options.title && details[0] === `Claude wants to use ${toolName}`) details.shift();
  const choices = canRemember
    ? ["", "1. Allow once", "2. Always allow this safe pattern", "3. Deny"]
    : ["", "1. Allow once", "2. Deny"];
  write(`\n${renderPanel(`PERMISSION · ${toolName.toUpperCase()}`, [...details, ...choices], { color })}\n`);

  while (true) {
    const raw = (await ask(`  ${colors.bold(colors.yellow("DECISION"))} ${colors.dim("(type a number)")} ${colors.yellow("❯")} `)).trim();
    const [choice, ...reasonParts] = raw.split(/\s+/);
    const normalized = choice.toLowerCase();
    if (["1", "y", "yes", "once"].includes(normalized)) {
      return { behavior: "allow", updatedInput: input };
    }
    if (canRemember && ["2", "a", "always"].includes(normalized)) {
      return {
        behavior: "allow",
        updatedInput: input,
        updatedPermissions: options.suggestions.filter((suggestion) => suggestion.destination === "localSettings"),
      };
    }
    const denyChoices = canRemember ? ["3", "n", "no", "deny"] : ["2", "n", "no", "deny"];
    if (denyChoices.includes(normalized)) {
      const reason = reasonParts.join(" ");
      return { behavior: "deny", message: reason || "User denied this action" };
    }
    write(`  ${colors.yellow("!")} ${colors.dim(`Please choose ${canRemember ? "1, 2, or 3" : "1 or 2"}. Your text was not sent to Claude.`)}\n`);
  }
}
