# Jev Auto Router

Jev Auto makes the ordinary `codex` terminal command choose a model for every prompt. It asks Jev to classify the current prompt, applies a deterministic policy, and starts that Codex turn with the selected model and reasoning effort.

The same Codex conversation is preserved between prompts. Only the model and effort can change, so a simple follow-up can use Luna and a difficult follow-up can move to Sol or Astra without starting another session.

## Routing policy

| Tier | Default model | Typical work |
| --- | --- | --- |
| Luna | `gpt-5.6-luna` | Clear, repeatable, mechanical tasks |
| Terra | `gpt-5.6-terra` | Everyday engineering work |
| Sol | `gpt-5.6-sol` | Complex, ambiguous, broad, or high-risk work |
| Astra | `gpt-6-astra` | Hardest end-to-end work requiring sustained judgment |

Jev evaluates complexity, risk, breadth, task type, and whether a material user decision is missing. High-risk and repository-wide work is promoted to at least Sol. Low classifier confidence promotes the task one tier. If Jev is unavailable, routing falls back to Terra/medium instead of blocking.

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

For every prompt, the terminal prints the selected model and effort before Codex answers:

```text
You › Fix the typo in README
[auto] gpt-5.6-luna · low · Jev 143 input tokens

Codex › ...
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

## Important limitation

The wrapper controls conversations started with this terminal command. It cannot intercept prompts typed into an already-running stock Codex TUI. Exit that old session and start a fresh one with `codex` after installation.

## Why this can save usage

Routine work can use a lighter model and lower reasoning effort, while difficult prompts are promoted. The Jev classification adds a small routing call, so actual savings should be measured over real tasks; retrying a badly routed task can erase the saving.
