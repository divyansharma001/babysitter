const TIER_RANK = { luna: 0, terra: 1, sol: 2, astra: 3 };
const EFFORT_RANK = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function chooseClaudeSessionRoute(candidate, state = {}, env = process.env) {
  const current = state.route;
  const contextTokens = state.contextTokens || 0;
  const turnsOnModel = state.turnsOnModel || 0;
  const cacheLockTokens = positiveInteger(env.JEV_AUTO_CLAUDE_CACHE_LOCK_TOKENS, 12_000);
  const minTurns = positiveInteger(env.JEV_AUTO_CLAUDE_MIN_TURNS_PER_MODEL, 3);

  if (!current) {
    return {
      route: { ...candidate, reasons: [...candidate.reasons, "cache-aware: initial session route"] },
      switched: true,
    };
  }

  if (candidate.model === current.model) {
    const currentEffort = EFFORT_RANK[current.effort] ?? 0;
    const candidateEffort = EFFORT_RANK[candidate.effort] ?? 0;
    if (candidateEffort <= currentEffort && candidate.effort !== current.effort) {
      return {
        route: {
          ...candidate,
          tier: current.tier,
          effort: current.effort,
          reasons: [...candidate.reasons, `cache-aware: kept ${current.model}/${current.effort}; lowering effort would reset Claude's prompt cache`],
        },
        switched: false,
      };
    }
    return { route: candidate, switched: candidate.effort !== current.effort };
  }

  const currentRank = TIER_RANK[current.tier] ?? 1;
  const candidateRank = TIER_RANK[candidate.tier] ?? 1;
  const isUpgrade = candidateRank > currentRank;
  const protectWarmCache = contextTokens >= cacheLockTokens || turnsOnModel < minTurns;

  if (!isUpgrade && protectWarmCache) {
    const reason = contextTokens >= cacheLockTokens
      ? `cache-aware: Jev suggested ${candidate.model}, but kept ${current.model} to avoid reloading ~${contextTokens.toLocaleString()} context tokens`
      : `cache-aware: Jev suggested ${candidate.model}, but kept ${current.model} for a ${minTurns}-turn minimum to avoid model thrashing`;
    return {
      route: {
        ...candidate,
        tier: current.tier,
        model: current.model,
        effort: current.effort,
        reasons: [...candidate.reasons, reason],
      },
      switched: false,
    };
  }

  return {
    route: {
      ...candidate,
      reasons: [...candidate.reasons, isUpgrade
        ? `cache-aware: quality upgrade from ${current.model} to ${candidate.model}`
        : `cache-aware: switched after ${turnsOnModel} stable turns while context was still small`],
    },
    switched: true,
  };
}

export function claudeUsage(result = {}) {
  const usage = result.usage || {};
  const input = usage.input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  return {
    input,
    cacheRead,
    cacheWrite,
    output: usage.output_tokens || 0,
    contextTokens: input + cacheRead + cacheWrite,
    costUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
  };
}
