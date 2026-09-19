const ROUTING_QUESTIONS = {
  complexity: {
    type: "score",
    instructions: "How much reasoning and implementation difficulty does this coding-agent task require? Judge the requested work, not the length or writing style of the prompt.",
    criteria: [
      "Simple, mechanical, or narrowly scoped; the solution is obvious.",
      "Routine engineering work with a few clear steps.",
      "Complex work involving ambiguity, multiple systems, debugging, or significant tradeoffs.",
      "Expert-level, high-stakes, or unusually difficult end-to-end work requiring sustained judgment.",
    ],
  },
  risk: {
    type: "score",
    instructions: "How costly would an incorrect coding-agent result or action be?",
    criteria: [
      "Low impact and easy to undo.",
      "Moderate impact but straightforward to review or reverse.",
      "High impact involving security, production, data, money, migrations, or external side effects.",
      "Critical impact where an error could cause severe or hard-to-recover harm.",
    ],
  },
  breadth: {
    type: "score",
    instructions: "How broad is the likely scope of work?",
    criteria: [
      "One answer or a very small localized edit.",
      "Several related edits within one component.",
      "Repository-wide, cross-system, or long-running work.",
    ],
  },
  task_type: {
    type: "choice",
    instructions: "What is the primary kind of work requested?",
    criteria: {
      explanation: "Answering, explaining, summarizing, or giving guidance.",
      mechanical_edit: "A clear, repetitive, or tightly specified code change.",
      implementation: "Building or changing functionality with normal engineering judgment.",
      debugging: "Investigating uncertain behavior or finding a root cause.",
      architecture_or_research: "System design, broad research, or decisions with substantial tradeoffs.",
      review: "Reviewing code, security, correctness, or quality.",
    },
  },
  needs_clarification: {
    type: "noul",
    instructions: "Is a missing user decision likely to materially change the correct implementation or make it unsafe to begin? A merely imperfect prompt is not enough; answer yes only when clarification is genuinely required.",
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function classifyPrompt(prompt, options = {}) {
  const apiKey = options.apiKey || process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error("TYPESAFE_API_KEY is not set");
  }

  const baseUrl = options.baseUrl || process.env.JEV_BASE_URL || "https://api.typesafe.ai";
  const model = options.model || process.env.JEV_MODEL || "jev-latest";
  const fetchImpl = options.fetchImpl || fetch;
  const maxAttempts = options.maxAttempts || 3;

  const body = {
    model,
    state: {
      prompt,
      metadata: {
        characters: prompt.length,
        lines: prompt.split("\n").length,
      },
    },
    questions: ROUTING_QUESTIONS,
  };

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const result = await response.json();
        return {
          model: result.model,
          usage: result.usage,
          signals: {
            complexity: result.answers.complexity,
            risk: result.answers.risk,
            breadth: result.answers.breadth,
            taskType: result.answers.task_type,
            needsClarification: result.answers.needs_clarification,
          },
        };
      }

      const detail = await response.text();
      lastError = new Error(`Jev returned ${response.status}: ${detail}`);
      if (![429, 529].includes(response.status) || attempt === maxAttempts) throw lastError;

      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** (attempt - 1));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !String(error.message).includes("fetch")) throw error;
      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}
