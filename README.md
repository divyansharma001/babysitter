# Babysitter

**Automatic model routing for Codex and Claude Code.**

Babysitter classifies each prompt with Jev, applies a small, inspectable routing policy, and runs that prompt with the appropriate model. It keeps the official `codex` and `claude` commands untouched:

```sh
bbs-codex   # a routed Codex session
bbs-claude  # a routed Claude Code session

codex       # normal Codex
claude      # normal Claude Code
```


## What it does

- Makes a new model decision for **every prompt**, not just once when a session starts.
- Preserves the conversation while using cache-aware model affinity to avoid wasteful Claude model switching.
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

`npm link` makes `bbs-codex` and `bbs-claude` available in your terminal. Your `.env` stays local and must never be committed.

### 3. Start a routed session

```sh
bbs-codex
# or
bbs-claude
```

You can also supply a first prompt directly:

```sh
bbs-codex "Find and fix the race condition in the payment worker"
bbs-claude "Find and fix the race condition in the payment worker"
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

`bbs-claude` runs Claude Code in print mode for each turn, selects `--model`, and resumes the returned session ID on the next turn. It sends `--effort` only to models that support it—Haiku uses Claude Code's default. The behavior relies on the officially supported [model, effort, print, and resume options](https://code.claude.com/docs/en/cli-reference).

Override Claude mappings with `JEV_AUTO_CLAUDE_LUNA_MODEL`, `JEV_AUTO_CLAUDE_TERRA_MODEL`, `JEV_AUTO_CLAUDE_SOL_MODEL`, or `JEV_AUTO_CLAUDE_ASTRA_MODEL`. Use a model ID only when it is available to your Claude Code account.

### Cache-aware Claude routing

Claude Code preserves a resumed conversation by making its previous messages available to the next request. That history still counts as context. [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) can make repeated context substantially cheaper, but the cache is model-specific: a cache created for Sonnet cannot be reused by Haiku or Opus. Changing Claude's [thinking or effort configuration](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost) can invalidate cached context too.

This means blindly switching models after every classification can cost more than it saves in a long chat. Babysitter therefore separates **classification** from **switching**: Jev still evaluates every prompt, while a cache-aware session policy decides whether changing the active Claude model is worth reloading the conversation.

The default policy is:

- Quality upgrades are allowed immediately.
- Downgrades wait until the current model has handled at least three turns.
- Once the estimated conversation context reaches 12,000 tokens, automatic downgrades are blocked to avoid loading the full history into another model.
- Lower effort is not applied inside a warm model session because it would reset the cache.
- A higher-effort quality upgrade can still happen when the selected tier requires it.
- `/compact` creates a focused handoff and starts a fresh routed session, allowing the next model to receive the important state without replaying the full transcript.

The route card explains when the selected model was kept for cache safety or changed for quality. After an answer, Babysitter displays the usage information returned by Claude Code:

| Field | Meaning |
| --- | --- |
| `new` | Uncached input tokens processed for this request |
| `cache read` | Earlier context reused from Claude's prompt cache |
| `cache write` | Context written into a new or updated cache entry |
| `output` | Tokens generated in the response |
| `cost` | Provider-reported cost, when Claude Code supplies it |

Cached tokens may still appear in usage totals; a cache read is not the same as paying the full uncached-input rate. Subscription limits and API billing are controlled by Anthropic and may account for usage differently. Babysitter reports the provider values without inventing an estimated saving.

Change the session-affinity defaults with `JEV_AUTO_CLAUDE_CACHE_LOCK_TOKENS` and `JEV_AUTO_CLAUDE_MIN_TURNS_PER_MODEL`.

#### What `/compact` does in `bbs-claude`

Babysitter's Claude `/compact` deliberately creates a new session rather than asking a different model to load the entire old transcript:

1. The active model creates a concise handoff containing the goal, decisions, constraints, relevant files, completed work, verification results, unresolved issues, and next steps.
2. Babysitter closes the active routing context while leaving the original Claude session saved.
3. The next user prompt is classified normally.
4. The selected model starts a fresh Claude session with the compact handoff plus the new prompt.

You can add a focus instruction:

```text
/compact preserve the database migration decisions and remaining test failures
```

Compaction trades perfect transcript fidelity for a much smaller context. Use `/native` when you need Claude Code's own compaction behavior instead.

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
| `JEV_AUTO_CLAUDE_CACHE_LOCK_TOKENS` | Context estimate after which automatic Claude downgrades stop; defaults to `12000` |
| `JEV_AUTO_CLAUDE_MIN_TURNS_PER_MODEL` | Minimum turns before an automatic Claude downgrade; defaults to `3` |
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
bbs-codex exec "Review the current changes for security problems"
```

## Resume saved sessions

Babysitter can resume a provider session and continue routing **each new prompt**.

```sh
# List saved Codex threads, then copy an ID if you want one directly
bbs-codex sessions

# Choose from the saved Codex threads in an interactive picker
bbs-codex resume

# Resume one Codex thread directly
bbs-codex resume <thread-id>

# Continue the most recent Claude Code session in this directory
bbs-claude continue
bbs-claude -c
bbs-claude --continue

# Resume a Claude Code session by its ID or name
bbs-claude resume <session-id-or-name>
bbs-claude -r <session-id-or-name>
bbs-claude --resume <session-id-or-name>
```

`resume`, `-r`, and `--resume` are equivalent. You can append the first prompt, for example `bbs-claude -r auth-refactor "Finish this PR"`. Likewise, `continue`, `-c`, and `--continue` all use the routed continue behavior.

`bbs-claude` prints its session ID after a successful response so it can be resumed later. Resuming preserves the conversation, but the first routed prompt may still cause a cache miss if Jev selects a different model than the one previously used in that session.

Running `bbs-claude -r` without an ID, or running `bbs-claude sessions`, opens Claude Code's native session picker for browsing. That picker is provider-owned and runs as normal Claude Code; pass the selected ID or name to `bbs-claude -r` to return to a routed Babysitter session.

## Slash commands and native terminals

Babysitter implements the commands that need to cooperate with routing and context management:

| Command | Claude | Codex |
| --- | --- | --- |
| `/compact` | Creates a compact handoff, then starts a fresh routed session on the next prompt | Runs Codex's official thread-compaction operation |
| `/status` | Shows session, active route, effort, and context estimate | Shows the active thread and routing state |
| `/new` or `/clear` | Starts a fresh routed session | Use `/native` and the official Codex command |
| `/rc [name]` | Resumes the current session with Claude Remote Control; routing pauses while native Claude is open | Not available in Codex |
| `/native` | Opens the current session in the complete Claude Code terminal | Hands the current thread to the complete Codex terminal |
| `/help` | Shows Babysitter commands | Shows Babysitter commands |

Provider CLIs have many commands and can add more over time. Babysitter does not pretend to reimplement all of them: use `/native` whenever you need the official terminal. The same saved session is handed over, so its conversation is retained. Automatic routing is paused while the native provider terminal owns the session.

Unknown slash commands are never silently sent to the model as ordinary prompt text. Babysitter explains that the command is not implemented and directs the user to `/native`.

## Limitations

- Babysitter only controls sessions started with `bbs-codex` or `bbs-claude`; it cannot intercept prompts in an already-running official session.
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
