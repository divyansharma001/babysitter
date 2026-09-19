const ROUTED_PERMISSION_MODES = new Set(["acceptEdits", "plan", "dontAsk", "auto"]);

export function claudePermissionMode(env = process.env) {
  const configured = env.JEV_AUTO_CLAUDE_PERMISSION_MODE?.trim();
  return ROUTED_PERMISSION_MODES.has(configured) ? configured : "acceptEdits";
}

export function isRoutedPermissionMode(mode) {
  return ROUTED_PERMISSION_MODES.has(mode);
}

export function claudePermissionArgs(mode = "acceptEdits") {
  return ["--permission-mode", mode, "--permission-prompts", "none"];
}

export function hasClaudePermissionOverride(args) {
  return args.some((arg) =>
    arg === "--permission-mode" ||
    arg.startsWith("--permission-mode=") ||
    arg === "--permission-prompts" ||
    arg.startsWith("--permission-prompts="));
}
