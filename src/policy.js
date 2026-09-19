const DEFAULT_MODELS = {
  luna: "gpt-5.6-luna",
  terra: "gpt-5.6-terra",
  sol: "gpt-5.6-sol",
  astra: "gpt-6-astra",
};

const DEFAULT_CLAUDE_MODELS = {
  luna: "haiku",
  terra: "sonnet",
  sol: "opus",
  astra: "fable",
};

const CLAUDE_TIER_LABELS = {
  luna: "haiku",
  terra: "sonnet",
  sol: "opus",
  astra: "fable",
};

const LEVELS = ["luna", "terra", "sol", "astra"];

function clampLevel(level) {
  return Math.max(0, Math.min(LEVELS.length - 1, level));
}

function modelCatalog(env = process.env, provider = "codex") {
  const defaults = provider === "claude" ? DEFAULT_CLAUDE_MODELS : DEFAULT_MODELS;
  const prefix = provider === "claude" ? "JEV_AUTO_CLAUDE_" : "JEV_AUTO_";
  return {
    luna: env[`${prefix}LUNA_MODEL`] || defaults.luna,
    terra: env[`${prefix}TERRA_MODEL`] || defaults.terra,
    sol: env[`${prefix}SOL_MODEL`] || defaults.sol,
    astra: env[`${prefix}ASTRA_MODEL`] || defaults.astra,
  };
}

export function routeTask(signals, env = process.env, provider = "codex") {
  const complexity = Math.round(signals.complexity.score);
  const risk = Math.round(signals.risk.score);
  const breadth = Math.round(signals.breadth.score);

  // OpenAI's model guide positions Luna for clear/repeatable work, Terra for
  // everyday work, Sol for complex/open-ended work, and Astra only for the
  // hardest end-to-end workflows. Start from complexity, then require a
  // corroborating high-impact signal before allowing Astra.
  let level = Math.min(complexity, 2);
  const reasons = [`complexity=${complexity}/3`];

  if (risk >= 2 && level < 2) {
    level = 2;
    reasons.push("high-risk work requires at least Sol");
  }

  if (breadth >= 2 && level < 2) {
    level = 2;
    reasons.push("repository-wide scope requires at least Sol");
  }

  const classifierConfidence = Math.min(
    signals.complexity.confidence,
    signals.risk.confidence,
    signals.breadth.confidence,
    signals.taskType.confidence,
  );

  const astraEligible = complexity === 3 && (risk >= 2 || breadth >= 2);
  if (astraEligible) {
    level = 3;
    reasons.push("Astra requires complexity=3 plus high risk or broad scope");
  } else if (complexity === 3) {
    reasons.push("Astra gate not met; capped at Sol");
  }

  if (classifierConfidence < 0.45) {
    reasons.push("low confidence noted; tier not increased");
  }

  level = clampLevel(level);
  const tier = LEVELS[level];

  let effort = "low";
  if (level === 1) effort = "medium";
  if (level === 2) effort = complexity === 3 || risk === 3 ? "xhigh" : "high";
  if (level === 3) effort = "xhigh";

  return {
    tier,
    model: modelCatalog(env, provider)[tier],
    effort,
    needsHumanInput: signals.needsClarification.noul >= 0.72,
    clarificationProbability: signals.needsClarification.noul,
    classifierConfidence,
    reasons,
  };
}

export function fallbackRoute(env = process.env, provider = "codex") {
  return {
    tier: "terra",
    model: modelCatalog(env, provider).terra,
    effort: "medium",
    needsHumanInput: false,
    clarificationProbability: null,
    classifierConfidence: null,
    reasons: ["Jev unavailable; conservative fallback"],
  };
}

export function claudeRouteView(route) {
  const replacements = [
    [/Astra/g, "Fable"],
    [/Sol/g, "Opus"],
    [/Terra/g, "Sonnet"],
    [/Luna/g, "Haiku"],
  ];
  const reasons = (route.reasons || []).map((reason) => replacements.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    reason,
  ));
  return {
    ...route,
    displayTier: CLAUDE_TIER_LABELS[route.tier] || route.model,
    reasons,
  };
}
