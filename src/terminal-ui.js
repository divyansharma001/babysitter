import process from "node:process";

const CODES = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  italic: "\u001b[3m",
  underline: "\u001b[4m",
  green: "\u001b[38;5;114m",
  cyan: "\u001b[38;5;81m",
  yellow: "\u001b[38;5;221m",
  magenta: "\u001b[38;5;177m",
  red: "\u001b[38;5;203m",
  gray: "\u001b[38;5;245m",
};

export function hasColor(stream = process.stdout, env = process.env) {
  return Boolean(stream.isTTY && !env.NO_COLOR && env.TERM !== "dumb");
}

function style(code, value, color) {
  return color ? `${CODES[code]}${value}${CODES.reset}` : String(value);
}

export function palette(color = hasColor()) {
  return Object.fromEntries(
    Object.keys(CODES)
      .filter((name) => name !== "reset")
      .map((name) => [name, (value) => style(name, value, color)]),
  );
}

function inlineMarkdown(value, colors) {
  const saved = [];
  let text = value.replace(/`([^`]+)`/g, (_, code) => {
    saved.push(colors.cyan(code));
    return `\u0000${saved.length - 1}\u0000`;
  });
  text = text
    .replace(/\*\*([^*]+)\*\*/g, (_, strong) => colors.bold(strong))
    .replace(/__([^_]+)__/g, (_, strong) => colors.bold(strong))
    .replace(/\*([^*]+)\*/g, (_, emphasis) => colors.italic(emphasis))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `${colors.underline(label)} ${colors.dim(`(${url})`)}`);
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => saved[Number(index)]);
}

export function renderMarkdown(markdown, { color = hasColor() } = {}) {
  const colors = palette(color);
  let fenced = false;

  return markdown.trim().split("\n").map((line) => {
    const fence = line.match(/^```\s*(.*)$/);
    if (fence) {
      fenced = !fenced;
      return fenced && fence[1] ? colors.dim(`  ${fence[1]}`) : "";
    }
    if (fenced) return colors.green(`  ${line}`);

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) return `\n${colors.bold(colors.magenta(inlineMarkdown(heading[2], colors)))}`;

    const bullet = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (bullet) return `${bullet[1]}${colors.cyan("•")} ${inlineMarkdown(bullet[2], colors)}`;

    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (numbered) return `${numbered[1]}${colors.cyan(`${numbered[2]}.`)} ${inlineMarkdown(numbered[3], colors)}`;

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) return `${colors.yellow("│")} ${colors.dim(inlineMarkdown(quote[1], colors))}`;

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return colors.dim("─".repeat(48));
    return inlineMarkdown(line, colors);
  }).join("\n");
}

function tierColor(tier, colors) {
  return ({ luna: colors.green, terra: colors.cyan, sol: colors.yellow, astra: colors.magenta })[tier] || colors.cyan;
}

export function printWelcome(stream = process.stdout) {
  const colors = palette(hasColor(stream));
  stream.write(`\n${colors.cyan("╭──────────────────────────────────────────────╮")}\n`);
  stream.write(`${colors.cyan("│")}  ${colors.bold(colors.magenta("◆ JEV AUTO"))}  ${colors.dim("smart model routing for Codex")}  ${colors.cyan("│")}\n`);
  stream.write(`${colors.cyan("╰──────────────────────────────────────────────╯")}\n`);
  stream.write(`${colors.dim("  A fresh route for every prompt · /exit to quit")}\n\n`);
}

export function printRoute(route, usage, fallback, stream = process.stdout) {
  const colors = palette(hasColor(stream));
  const accent = tierColor(route.tier, colors);
  const confidence = route.classifierConfidence == null ? "—" : `${Math.round(route.classifierConfidence * 100)}%`;
  const router = usage?.input_tokens ? `Jev · ${usage.input_tokens} input tokens` : fallback ? "fallback policy" : "Jev";
  const reason = route.reasons?.join("; ") || "prompt classification";

  stream.write(`${colors.gray("╭─")} ${colors.bold("ROUTE")} ${accent(`◆ ${route.tier.toUpperCase()}`)}\n`);
  stream.write(`${colors.gray("│")} ${colors.dim("Model")}       ${accent(route.model)}\n`);
  stream.write(`${colors.gray("│")} ${colors.dim("Effort")}      ${route.effort}\n`);
  stream.write(`${colors.gray("│")} ${colors.dim("Confidence")}  ${confidence}\n`);
  stream.write(`${colors.gray("│")} ${colors.dim("Why")}         ${reason}\n`);
  stream.write(`${colors.gray("│")} ${colors.dim("Router")}      ${router}\n`);
  stream.write(`${colors.gray("╰──────────────────────────────────────────────")}\n\n`);
}

export function printAnswer(output, job, stream = process.stdout) {
  const colors = palette(hasColor(stream));
  const ok = job.status === "complete";
  const elapsed = Math.max(0, Date.parse(job.completedAt) - Date.parse(job.startedAt));
  const seconds = (elapsed / 1000).toFixed(1);
  stream.write(`${colors.gray("╭─")} ${colors.bold(colors.magenta("CODEX"))}\n`);
  stream.write(`${renderMarkdown(output, { color: hasColor(stream) })}\n`);
  stream.write(`${colors.gray("╰─")} ${ok ? colors.green("✓ Complete") : colors.red("✗ Failed")} ${colors.dim(`· ${job.model} · ${seconds}s`)}\n\n`);
}

export function startSpinner(label, stream = process.stdout) {
  const colors = palette(hasColor(stream));
  if (!stream.isTTY) {
    stream.write(`${label}…\n`);
    return () => {};
  }
  const frames = ["◐", "◓", "◑", "◒"];
  let frame = 0;
  const draw = () => stream.write(`\r\u001b[2K${colors.cyan(frames[frame++ % frames.length])} ${colors.dim(label)}`);
  draw();
  const timer = setInterval(draw, 90);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    stream.write("\r\u001b[2K");
  };
}
