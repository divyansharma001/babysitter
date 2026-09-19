# Babysitter

**Automatic model routing for Codex and Claude Code.**

Babysitter classifies each prompt with Jev, applies a small, inspectable routing policy, and runs that prompt with the appropriate model. It keeps the official `codex` and `claude` commands untouched:

```sh
bbs-Codex   # a routed Codex session
bbs-Claude  # a routed Claude Code session

codex       # normal Codex
claude      # normal Claude Code
```


## What it does

- Makes a new model decision for **every prompt**, not just once when a session starts.
- Preserves the conversation while allowing the model and effort to change between turns.
- Shows the selected tier, model, effort/default, reason, and Jev token usage before the answer.
- Keeps routing rules deterministic and visible in [src/policy.js](src/policy.js).
- Uses separate launcher names, so it never replaces an existing Codex or Claude Code installation.

```text
YOU ❯ Fix the typo in README
╭─ ROUTE ◆ LUNA
│ Model       gpt-5.6-luna
│ Effort      low
│ Confidence  94%
│ Clarify     3% needs-user-decision probability
│ Why         complexity=0/3
│ Router      Jev · 143 input tokens
╰──────────────────────────────────────────────

╭─ CODEX
Updated README.md.
╰─ ✓ Complete · gpt-5.6-luna · 2.1s
```

## Quick start

### 1. Prerequisites

- Node.js 20 or later
- A TypeSafe API key for Jev
- The official [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) and/or [Claude Code CLI](https://code.claude.com/docs/en/setup)
- Authentication for each CLI you plan to use

### 2. Install Babysitter

```sh
git clone https://github.com/divyansharma001/babysitter.git
cd babysitter
cp .env.example .env
# Add your own TYPESAFE_API_KEY to .env
npm link
```

`npm link` makes `bbs-Codex` and `bbs-Claude` available in your terminal. Your `.env` stays local and must never be committed.

### 3. Start a routed session

```sh
bbs-Codex
# or
bbs-Claude
```

You can also supply a first prompt directly:

```sh
bbs-Codex "Find and fix the race condition in the payment worker"
bbs-Claude "Find and fix the race condition in the payment worker"
```

Type `/exit` or `/quit` to leave an interactive session.

## How routing works

For every prompt, Jev returns structured signals for complexity, risk, breadth, task type, and whether an important user decision is missing. Babysitter turns those signals into one of four tiers:

| Tier | Chosen for |
| --- | --- |
| Luna | Clear, repeatable, mechanical work |
| Terra | Everyday engineering work |
| Sol | Complex, ambiguous, broad, or high-risk work |
| Astra | The hardest work requiring both high complexity and high impact or broad scope |

The current policy intentionally stays conservative:

- Complexity `0 → Luna`, `1 → Terra`, `2 → Sol`.
- High-risk or repository-wide work is promoted to at least Sol.
- A `research` label or low classifier confidence alone does **not** promote a prompt.
- Astra requires complexity `3` and either high risk or broad scope; otherwise complexity `3` is capped at Sol.
- If Jev is unavailable, Babysitter uses Terra with medium effort rather than blocking the session.

These are Babysitter's local rules—not thresholds set by Jev, OpenAI, or Anthropic. Review or adjust them in [src/policy.js](src/policy.js).

## Model mappings

### Codex

| Babysitter tier | Default model | Typical role |
| --- | --- | --- |
| Luna | `gpt-5.6-luna` | Clear, repeatable tasks |
| Terra | `gpt-5.6-terra` | Everyday work |
| Sol | `gpt-5.6-sol` | Complex or open-ended work |
| Astra | `gpt-6-astra` | Hardest end-to-end workflows |

The defaults follow the [Codex model guide](https://learn.chatgpt.com/docs/models). Override a model with `JEV_AUTO_LUNA_MODEL`, `JEV_AUTO_TERRA_MODEL`, `JEV_AUTO_SOL_MODEL`, or `JEV_AUTO_ASTRA_MODEL`.

### Claude Code

| Babysitter tier | Default Claude Code model | Typical role | Effort |
| --- | --- | --- | --- |
| Luna | `haiku` | Fast, cost-conscious work and focused sub-tasks | Claude default |
| Terra | `sonnet` | Everyday coding and engineering | `medium` |
| Sol | `opus` | Complex coding, broad changes, and higher-risk work | `high` |
| Astra | `opus` | Hardest eligible work | `xhigh` |

This is a mapping rather than a claim that Claude has four matching model families. The [Claude model overview](https://platform.claude.com/docs/en/models/overview) positions Haiku as its fastest tier, Sonnet as the speed/intelligence balance, and Opus for complex agentic coding. Astra is therefore a stricter Babysitter tier on Opus, not a fourth Anthropic model.

`bbs-Claude` runs Claude Code in print mode for each turn, selects `--model`, and resumes the returned session ID on the next turn. It sends `--effort` only to models that support it—Haiku uses Claude Code's default. The behavior relies on the officially supported [model, effort, print, and resume options](https://code.claude.com/docs/en/cli-reference).

Override Claude mappings with `JEV_AUTO_CLAUDE_LUNA_MODEL`, `JEV_AUTO_CLAUDE_TERRA_MODEL`, `JEV_AUTO_CLAUDE_SOL_MODEL`, or `JEV_AUTO_CLAUDE_ASTRA_MODEL`. Use a model ID only when it is available to your Claude Code account.

## Configuration

Copy `.env.example` to `.env`. The only required setting is:

```dotenv
TYPESAFE_API_KEY=your_typesafe_key
```

Optional settings:

| Setting | Purpose |
| --- | --- |
| `JEV_MODEL` | Select the Jev model; defaults to `jev-latest` |
| `JEV_BASE_URL` | Override the Jev API base URL |
| `JEV_AUTO_*_MODEL` | Override a Codex tier's model |
| `JEV_AUTO_CLAUDE_*_MODEL` | Override a Claude tier's model |
| `JEV_AUTO_REAL_CODEX` | Full path to Codex if automatic discovery fails |
| `JEV_AUTO_REAL_CLAUDE` | Full path to Claude Code if automatic discovery fails |
| `NO_COLOR=1` | Disable colored terminal output |

The launcher checks the current directory's `.env` first, then Babysitter's `.env`.

## Claude Code authentication

Babysitter uses your locally installed, authenticated Claude Code CLI. It does not proxy or share credentials. Install and authenticate Claude Code using Anthropic's setup guide:

```sh
curl -fsSL https://claude.ai/install.sh | bash
claude auth login
```

For a redistributable agent product, use an Anthropic API key or supported cloud-provider credentials. Anthropic subscription OAuth is intended for the unmodified Claude Code application.

## Non-interactive Codex use

One-shot Codex commands are routed too:

```sh
bbs-Codex exec "Review the current changes for security problems"
```

## Limitations

- Babysitter only controls sessions started with `bbs-Codex` or `bbs-Claude`; it cannot intercept prompts in an already-running official session.
- A lightweight Jev classification call is made for every prompt. Savings depend on your workload, model availability, and whether the routing decision avoids retries.
- Model availability, effort controls, pricing, and authentication are determined by Codex and Claude Code accounts—not by Babysitter.
- Claude Code support requires the official CLI to be installed and authenticated locally.

## Security

- Never commit `.env` or publish API keys.
- Give every installer their own TypeSafe key and provider credentials.
- If a key appears in a commit, screenshot, issue, or chat, revoke it and issue a replacement immediately.

Before publishing a fork, verify:

```sh
git check-ignore .env
git status
```

## Development

```sh
npm run check
npm test
```

The project uses Node's built-in test runner and has no runtime dependency install step.

## Contributing

Issues and pull requests are welcome. If you change routing behavior, include a regression test and explain the cost/quality trade-off in the pull request.

## License

No license has been selected yet. Add a license before treating this repository as an open-source distribution.
