# Babysitter

Babysitter adds automatic per-prompt model routing without replacing the official `codex` or `claude` commands. Run `bbs-Codex` for a routed Codex session or `bbs-Claude` for a routed Claude Code session. Babysitter asks Jev to classify every prompt, applies a deterministic policy, and starts that turn with the selected model and reasoning effort.

Claude support uses the official Claude Code CLI, keeps a conversation alive with `--resume`, and maps Jev tiers to Haiku, Sonnet, and Opus. Set `JEV_AUTO_CLAUDE_LUNA_MODEL`, `JEV_AUTO_CLAUDE_TERRA_MODEL`, `JEV_AUTO_CLAUDE_SOL_MODEL`, or `JEV_AUTO_CLAUDE_ASTRA_MODEL` to pin different Claude model IDs. Set `JEV_AUTO_REAL_CLAUDE` only when automatic discovery cannot find the official executable.

The same conversation is preserved between prompts in each Babysitter session. Only the model and effort can change from turn to turn.

## Routing policy

| Tier | Default model | Typical work |
| --- | --- | --- |
| Luna | `gpt-5.6-luna` | Clear, repeatable, mechanical tasks |
| Terra | `gpt-5.6-terra` | Everyday engineering work |
| Sol | `gpt-5.6-sol` | Complex, ambiguous, broad, or high-risk work |
| Astra | `gpt-6-astra` | Hardest end-to-end work requiring sustained judgment |

Jev evaluates complexity, risk, breadth, task type, and whether a material user decision is missing. The policy follows the [official ChatGPT and Codex model guide](https://learn.chatgpt.com/docs/models): Luna handles clear repeatable work, Terra handles everyday work, Sol handles complex or open-ended work, and Astra is reserved for the hardest end-to-end workflows.

The local routing rules are intentionally narrow:

- Complexity `0 → Luna`, `1 → Terra`, and `2 → Sol`.
- High-risk or repository-wide work is promoted to at least Sol.
- Research as a task label does not promote a prompt by itself; its actual complexity and scope decide the tier.
- Low classifier confidence is displayed but never promotes the model by itself.
- Astra requires complexity `3` plus either high risk or broad scope. Otherwise, complexity `3` is capped at Sol.
- Reasoning effort starts low and increases only for tasks that need more planning or checking.

These numeric thresholds are this project's policy, not thresholds published by OpenAI or Jev. If Jev is unavailable, routing falls back to Terra/medium instead of blocking.

## Setup

Requirements: Node.js 20+, a TypeSafe API key, and the official Codex CLI and/or Claude Code CLI you want Babysitter to route.

```sh
cp .env.example .env
# Add TYPESAFE_API_KEY to .env, then:
npm link
```

The launcher checks the current directory's `.env` and then this router's `.env`. Keep the key out of source control.

## Use

Start a Babysitter-routed Codex session:

```sh
bbs-Codex
```

Start a Babysitter-routed Claude Code session:

```sh
bbs-Claude
```

The original commands remain unchanged:

```sh
codex   # normal Codex CLI
claude  # normal Claude Code CLI
```

The Claude launcher requires an authenticated Claude Code installation. For a shareable agent product, use an Anthropic API key or supported cloud-provider credentials; Anthropic’s subscription OAuth is intended for the unmodified Claude Code application.

The Claude wrapper routes every prompt by running Claude Code in print mode and resuming the same session ID with that turn's `--model` and `--effort`. Claude Code officially supports print mode, session resume, model selection, and effort selection through these CLI flags.

For every prompt, the terminal shows a colored routing card before Codex answers. It includes the selected tier, model, effort, classifier confidence, routing reason, and Jev token usage. Codex Markdown is rendered as readable terminal headings, lists, quotes, inline code, and code blocks.

```text
YOU ❯ Fix the typo in README
╭─ ROUTE ◆ LUNA
│ Model       gpt-5.6-luna
│ Effort      low
│ Confidence  94%
│ Why         complexity=0/3
│ Router      Jev · 143 input tokens
╰──────────────────────────────────────────────

╭─ CODEX
Updated README.md.
╰─ ✓ Complete · gpt-5.6-luna · 2.1s
```

You can also start with a prompt:

```sh
bbs-Codex "Find and fix the race condition in the payment worker"
```

Type `/exit` or `/quit` to leave the session.

Non-interactive Babysitter execution is also routed once:

```sh
bbs-Codex exec "Review the current changes for security problems"
```

Set `JEV_AUTO_REAL_CODEX` only if the wrapper cannot locate the real Codex executable.

Set the standard `NO_COLOR=1` environment variable if you need plain terminal output.

## Share it from GitHub

Before publishing, make sure `.env` is not committed. This repository already ignores it, but verify with:

```sh
git check-ignore .env
git status
```

Never publish a real TypeSafe key. If a key appears in a screenshot, commit, issue, or chat, revoke it and create a new one.

Someone installing your GitHub project needs Node.js 20+, their own TypeSafe API key, and whichever official CLI they want Babysitter to route. Babysitter uses separate command names, so it does not replace either official CLI.

```sh
# First install Codex, then authenticate once
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex login

# Optional: install Claude Code, then authenticate once
curl -fsSL https://claude.ai/install.sh | bash
claude auth login

# Install this router from GitHub
git clone https://github.com/divyansharma001/babysitter.git
cd babysitter
cp .env.example .env
# Put the installer's own TYPESAFE_API_KEY in .env
npm link

# Start either routed terminal
bbs-Codex
bbs-Claude
```

Each person supplies their own key; `.env` is never shared. To receive updates later, they can run `git pull` in the cloned repository. Because `npm link` points at that checkout, no reinstall is normally needed unless the package metadata changes.

For a polished public release, add a license, include one screenshot or short terminal recording, and tag releases such as `v0.1.0`. Publishing to npm can come later; a GitHub clone plus `npm link` is enough for the first users.

## Important limitation

Babysitter controls only conversations started with `bbs-Codex` or `bbs-Claude`. It does not intercept prompts typed into an already-running official Codex or Claude session.

## Why this can save usage

Routine work can use a lighter model and lower reasoning effort, while difficult prompts are promoted. The Jev classification adds a small routing call, so actual savings should be measured over real tasks; retrying a badly routed task can erase the saving.
