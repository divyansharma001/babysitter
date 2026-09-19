# Jev Auto Router

Jev Auto makes the ordinary `codex` or `claude` terminal command choose a model for every prompt. It asks Jev to classify the current prompt, applies a deterministic policy, and starts that turn with the selected model and reasoning effort.

Claude support is available through the `claude` binary. It uses the official Claude Code CLI, keeps a conversation alive with `--resume`, and maps Jev tiers to Haiku, Sonnet, and Opus. Set `JEV_AUTO_CLAUDE_LUNA_MODEL`, `JEV_AUTO_CLAUDE_TERRA_MODEL`, `JEV_AUTO_CLAUDE_SOL_MODEL`, or `JEV_AUTO_CLAUDE_ASTRA_MODEL` to pin different Claude model IDs.

The same Codex conversation is preserved between prompts. Only the model and effort can change, so a simple follow-up can use Luna and a difficult follow-up can move to Sol or Astra without starting another session.

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

Requirements: Node.js 20+, Codex CLI, and a TypeSafe API key.

```sh
cp .env.example .env
# Add TYPESAFE_API_KEY to .env, then:
npm link
```

The launcher checks the current directory's `.env` and then this router's `.env`. Keep the key out of source control.

## Use

Start the terminal chat exactly as you normally start Codex:

```sh
codex
```

For Claude Code, use:

```sh
claude
```

The Claude launcher requires an authenticated Claude Code installation. For a shareable agent product, use an Anthropic API key or supported cloud-provider credentials; Anthropic’s subscription OAuth is intended for the unmodified Claude Code application.

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
codex "Find and fix the race condition in the payment worker"
```

Type `/exit` or `/quit` to leave the session.

Operational commands still go directly to the real Codex CLI, including `codex login`, `codex --help`, and `codex --version`. Non-interactive execution is also routed once:

```sh
codex exec "Review the current changes for security problems"
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

Someone installing your GitHub project needs Node.js 20+, their own TypeSafe API key, and the official Codex CLI. The standalone Codex installer is recommended because this project wraps the `codex` command.

```sh
# First install Codex, then authenticate once
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex login

# Install this router from GitHub
git clone https://github.com/divyansharma001/babysitter.git
cd babysitter
cp .env.example .env
# Put the installer's own TYPESAFE_API_KEY in .env
npm link

# Start the routed terminal
codex
```

Each person supplies their own key; `.env` is never shared. To receive updates later, they can run `git pull` in the cloned repository. Because `npm link` points at that checkout, no reinstall is normally needed unless the package metadata changes.

For a polished public release, add a license, include one screenshot or short terminal recording, and tag releases such as `v0.1.0`. Publishing to npm can come later; a GitHub clone plus `npm link` is enough for the first users.

## Important limitation

The wrapper controls conversations started with this terminal command. It cannot intercept prompts typed into an already-running stock Codex TUI. Exit that old session and start a fresh one with `codex` after installation.

## Why this can save usage

Routine work can use a lighter model and lower reasoning effort, while difficult prompts are promoted. The Jev classification adds a small routing call, so actual savings should be measured over real tasks; retrying a badly routed task can erase the saving.
