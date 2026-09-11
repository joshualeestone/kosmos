# Plan: #2826 - setAccount can swap a CODEX agent's OpenAI account

## What finished looks like
`create.setAccount(name, dir)` on a **codex** agent resolves `dir` against
`openaiaccounts.list()` (the `~/.codex*` homes), rewrites the plist with the new
`CODEX_HOME`, and trusts the worker folder in the new home's `config.toml` - the
codex analog of what it already does for a Claude agent. A named codex account is
selected; the default row writes no `CODEX_HOME` (#1600); an unknown codex home is
refused; and a **Claude** agent handed a codex dir is STILL refused (a runner
switch is `setProvider`'s job, not this).

## Why now
April measured the defect with a discriminating control (#2826): the old
`setAccount` resolved every account against `accounts.list()`, which scans
`~/.claude*` only. So a codex account was an unknown account and was refused at
`REFUSE_ACCOUNT` *before* the runner was ever consulted - Dave's actual blocker.
The #2790 file-collision in `openaiaccounts.js` cleared when #2790 merged
(48effa49), so this is now safe to build.

## Root, refined past the measurement
`REFUSE_ACCOUNT` fired at the account resolution (Claude-only), which ran *before*
the codex-runner refusal. A codex-dir target was refused there for any agent.

## Changes
`engine/create.js`:
1. `setAccount` reads the job FIRST (moved `readJob` above the account
   resolution) and branches by runner: a codex agent → new `setCodexAccount`.
   The Claude path is otherwise unchanged (its refusals still fire in the same
   order relative to each other; only "missing job" now precedes "unknown
   account", which no test pins and which is harmless - a missing job changes
   nothing either way).
2. `setCodexAccount(clean, spoken, dir, job)` - mirrors `setProvider`'s codex
   path: resolve in `openaiaccounts.list()` (`path.resolve`'d like `wantDir`);
   `homeArg = acct.isDefault && !codexHomeOverridden() ? null : acct.dir` (the
   #1600 default-row rule, same expression `setProvider` writes); rewrite the
   plist via `plistFor(..., homeArg, 'codex')` keeping `job.model`; trust the
   folder in the home the agent will actually boot (`trustCodexFolder`, tied to
   `homeArg` so plist and trust cannot diverge). Best-effort/non-gating trust,
   matching the Claude sibling's #1629 reasoning. Reuses the shared
   `REFUSE_ACCOUNT` constant.
3. Two now-stale "codex is refused above" comments on the Claude path updated to
   "a codex agent branched off to setCodexAccount above".

`engine/create.test.js`:
- New test `#2826: setAccount swaps a codex agent between OpenAI accounts, and
  still refuses a claude agent a codex dir` - asserts premises (list() reports
  both homes, dave is not default, homes differ), the named swap (CODEX_HOME
  written, runner kept, identity kept, new home trusted), the default swap-back
  (no CODEX_HOME), the unknown-home refusal (nothing rewritten), and the
  claude-agent control (still refused). Positive-controlled: reverting the branch
  reds it.
- The "each refusal sentence exists exactly once" guard: `REFUSE_ACCOUNT` uses
  bumped 2 → 3 (a legitimate new site that correctly reuses the constant), and
  its header prose updated to name `setCodexAccount`.

## Scope boundary (measured, and NOT in this PR)
This is the ENGINE resolver fix the card names. The board's per-agent account
MOVE picker (`web/index.html` `paintAccountPicker`) does NOT yet offer codex
accounts for a codex agent: `movable = ACCOUNTS.filter(x => x.memoryShared)`
filters on a Claude-only field (openai rows carry no `memoryShared`), and it does
not filter by the agent's provider. So this PR unblocks the CLI / `POST
/api/agent/<name>/account` path; the UI move picker is a separate web/ change
(its own review + browser-check surface) filed as a follow-up card, built next.

## Weakest premise
That Dave's path onto the new account is the CLI/API rather than the board UI. If
he uses the UI move picker, he is not fully unblocked until the follow-up lands;
the engine fix here is a strict prerequisite for it either way.

## Verification
`node --test engine/create.test.js` - 162/162 pass. New test positive-controlled
(reverting the runner branch fails it). No web/ files changed, so no browser-check
gate applies to this PR.
