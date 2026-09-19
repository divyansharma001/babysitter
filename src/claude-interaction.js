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
  if (toolName === "AskUserQuestion") {
    const answers = {};
    for (const question of input.questions || []) {
      write(`\n? ${question.question}\n`);
      for (const [index, option] of (question.options || []).entries()) {
        write(`  ${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}\n`);
      }
      const suffix = question.multiSelect ? "Choose numbers separated by commas, or type an answer: " : "Choose a number, or type an answer: ";
      const raw = await ask(suffix);
      answers[question.question] = answerClaudeQuestion(question, raw);
    }
    return { behavior: "allow", updatedInput: { ...input, answers } };
  }

  write(`\n${describeClaudeTool(toolName, input, options)}\n`);
  const canRemember = !options.suppressAlwaysAllowRule && (options.suggestions || []).some((suggestion) => suggestion.destination === "localSettings");
  const choices = canRemember ? "[y] allow once  [a] always allow  [n] deny: " : "[y] allow once  [n] deny: ";
  const raw = (await ask(choices)).trim();
  const [choice, ...reasonParts] = raw.split(/\s+/);
  if (choice.toLowerCase() === "a" && canRemember) {
    return {
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: options.suggestions.filter((suggestion) => suggestion.destination === "localSettings"),
    };
  }
  if (["y", "yes"].includes(choice.toLowerCase())) return { behavior: "allow", updatedInput: input };
  const reason = reasonParts.join(" ");
  return { behavior: "deny", message: reason || "User denied this action" };
}
