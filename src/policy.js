const DEFAULT_MODELS = {
  luna: "gpt-5.6-luna",
  terra: "gpt-5.6-terra",
  sol: "gpt-5.6-sol",
  astra: "gpt-6-astra",
};

const LEVELS = ["luna", "terra", "sol", "astra"];

function clampLevel(level) {
  return Math.max(0, Math.min(LEVELS.length - 1, level));
}

function modelCatalog(env = process.env) {
  return {
    luna: env.JEV_AUTO_LUNA_MODEL || DEFAULT_MODELS.luna,
    terra: env.JEV_AUTO_TERRA_MODEL || DEFAULT_MODELS.terra,
    sol: env.JEV_AUTO_SOL_MODEL || DEFAULT_MODELS.sol,
    astra: env.JEV_AUTO_ASTRA_MODEL || DEFAULT_MODELS.astra,
  };
}

export function routeTask(signals, env = process.env) {
  const complexity = Math.round(signals.complexity.score);
  const risk = Math.round(signals.risk.score);
  const breadth = Math.round(signals.breadth.score);

  let level = complexity;
  const reasons = [`complexity=${complexity}/3`];

  if (risk >= 2 && level < 2) {
    level = 2;
    reasons.push("high-risk work requires at least Sol");
  }

  if (breadth >= 2 && level < 2) {
    level = 2;
    reasons.push("repository-wide scope requires at least Sol");
  }

  if (signals.taskType.choice === "architecture_or_research" && level < 2) {
    level = 2;
    reasons.push("architecture/research requires at least Sol");
  }

  const classifierConfidence = Math.min(
    signals.complexity.confidence,
    signals.risk.confidence,
    signals.breadth.confidence,
    signals.taskType.confidence,
  );

  if (classifierConfidence < 0.45 && level < 3) {
    level += 1;
    reasons.push("low router confidence promoted one tier");
  }

  level = clampLevel(level);
  const tier = LEVELS[level];

  let effort = "low";
  if (level === 1) effort = "medium";
  if (level === 2) effort = risk >= 2 ? "xhigh" : "high";
  if (level === 3) effort = "xhigh";

  return {
    tier,
    model: modelCatalog(env)[tier],
    effort,
    needsHumanInput: signals.needsClarification.noul >= 0.72,
    clarificationProbability: signals.needsClarification.noul,
    classifierConfidence,
    reasons,
  };
}

export function fallbackRoute(env = process.env) {
  return {
    tier: "terra",
    model: modelCatalog(env).terra,
    effort: "medium",
    needsHumanInput: false,
    clarificationProbability: null,
    classifierConfidence: null,
    reasons: ["Jev unavailable; conservative fallback"],
  };
}
