# CLAUDE.md

This file guides Claude Code when working in the **Kosmos** repository (the app is
`agent-workforce`; the product is Kosmos: "manage a workforce of AI agents on your own
Mac"). Read it, and `~/.claude/CLAUDE.md` (the machine-wide conventions), before starting
work. Both load automatically, but a challenge-loop reviewer's Step 1 reads this file
explicitly to learn the repo's pre-PR commands and conventions.

## Commands

### Run

- `node server.js` (or `yarn start`) launches the local board (a web server). The board's
  port is derived per-OS-user, not fixed, so do not assume a specific port.
- The shipped product is a bundle (the app + a pinned Node runtime + the `kosmos` CLI)
  under `~/.local/share/kosmos`, installed via
  `curl -fsSL https://installkosmos.com/setup | sh` (runs `install/setup.sh`). There is no
  Electron; `native-app/main.swift` is the thin macOS wrapper that fronts the bundle.

### Test

- `yarn test` runs `bash tools/run-tests.sh` (the canonical runner). Do NOT invoke
  `node --test` with a bare glob directly (see Repo-Specific Conventions below).
- `yarn test:shell` runs the large shell-and-tooling suite (`bash -n` syntax checks plus
  focused tool tests); `run-tests.sh` invokes it.
- `yarn test:install` / `test:install-gate` exercise the installer.
- **Use yarn, not npm.** The scripts are also npm-runnable, but `tools/run-tests.sh` itself
  shells out to `yarn` (`yarn -s test:shell`, and it self-invokes `yarn test`), and its own
  coverage-mismatch message names `yarn test` the canonical helper, so yarn must be present
  regardless. There is no committed lockfile or `packageManager` pin.

### Build / Lint

- **No build step for the app** (it runs from source). Release bundles are cut by
  `tools/build-*-bundle.sh` and `tools/release.sh`.
- **No linter and no type-checker.** The `type-check` and `lint-fix` scripts are intentional
  no-ops: this is plain JavaScript, not TypeScript.

## Architecture

### High-Level Structure

A single-app Node.js codebase (plain JavaScript, `node >=26`). The board is a local web
server (`server.js`) whose UI is a single committed page (`web/index.html`). The engine
(`engine/`, over 100 source modules plus their colocated `*.test.js`) holds the domain logic:
accounts, agents, chat, activity, the
board-auth model, install/update, multi-world ("Kosmos") switching, and provider sessions
(Claude Code and Codex). Tooling in `tools/` builds, releases, and gates the product;
`install/` is the end-user installer.

### Module Map

| Directory | Purpose |
|-----------|---------|
| `engine/` | Core domain logic (over 100 source modules, plus colocated `*.test.js`): accounts, agents, chat, activity, board-auth, autoupdate, worlds (multi-Kosmos), provider sessions. `engine/store.js` owns the ONE data-root derivation (`store.ROOT`). |
| `web/` | The board UI: a single committed page (`web/index.html`) plus icons and the web manifest. |
| `tools/` | Build, release, and gate scripts. `tools/run-tests.sh` is the canonical test runner; `tools/lib/` holds shared shell libs; `tools/release.sh` cuts releases. |
| `install/` | The end-user installer (`setup.sh`, the `kosmos` command, pkg scripts). |
| `deploy/` | Board/site deploy scripts (`deploy/install-board.sh`). |
| `bin/` | Runtime helpers: `bin/agent-supervisor.sh`, the Codex report bridge, etc. |
| `native-app/` | `main.swift`, the thin macOS app wrapper that fronts the bundle. |
| `docs/` | Repo docs, including `docs/browser-checks/` (rendered-surface assertions), `docs/walks/`, `docs/screenshots/`. |
| `assets/` | The Kosmos icon master and generated `.icns`. |
| `test-support/` | Test fixtures and helpers (`fake-tmux.sh`, discovery fixtures). |
| `.githooks/` | Committed git hooks (`pre-commit`, `prepare-commit-msg`). |

## Where to Find Things

| Task | Where to Look |
|------|---------------|
| Run the test suite the way CI does | `yarn test` -> `tools/run-tests.sh` |
| Add or change a test | Colocated `*.test.js` next to the code; the runner considers every `*.test.js` in the tree (see Repo-Specific Conventions) |
| Change the board UI | `web/index.html` (single page); a committed change here needs a browser-check assertion or a `Browser-check:` trailer |
| Find the data root / Application Support path | `engine/store.js` (`store.ROOT`) |
| Work on multi-Kosmos switching | `engine/worlds.js`, `engine/worldenv.js`, `engine/worldbootguard.js`, `engine/boardrestart.js`; the switch route in `server.js` (`/api/worlds/active`) |
| Add a provider session reader | `engine/claudeaccounts.js`, `engine/codexsession.js`, `engine/authprobe.js` |
| Change the installer | `install/setup.sh`, `install/kosmos` |
| Cut a release | `tools/release.sh`, `tools/build-*-bundle.sh` |

## Development Process and Conventions

The machine-wide `~/.claude/CLAUDE.md` carries the fleet-wide rules (worktrees, secrets,
messaging). The conventions below are the ones that govern working IN this repo, so a
challenge-loop reviewer and every agent have them in one place.

### Process applies to every change

The full process applies to every change, regardless of size. Never offer to skip a step or
call a change "too small" to plan, test, or review. Every branch requires all of:

1. A plan file in `.claude/plans/<branch>-<timestamp>.md` (even a brief one).
2. A worktree (never work in the main checkout).
3. Tests, if the change affects runtime behavior.
4. A `/challenge-loop` review to convergence.
5. A PR with code comments on the files-changed tab.

Documentation-only changes still require a plan and a `/challenge-loop` (the plan records
why; the loop can catch convention mismatches in the docs).

### Branch and commit format

- Flat branch names, no folder prefixes (`fix-switch-revert`, `worlds-boot-diag-2628`).
- Commit subject: `<branch-name> -- <message>` (single sentence, no special characters).
- Never push more commits onto a branch that already has an open or merged PR; branch off
  `main` again instead.

### Plans

Plans live in `.claude/plans/<branch-name>-<timestamp>.md`, are committed and tracked (do
not gitignore them), and are checked during `/challenge-loop` (a missing plan is a
convention violation). They are durable context, not scratch files: forensic record, agent
ramp-up, audit trail.

### Coding conventions

- **Naming**: verbose and descriptive over abbreviations; function names read like a
  description of what they do.
- **Constants**: no raw domain literals; extract to `SCREAMING_CASE` with a doc comment on
  why the value was chosen. Cross-module constants go in a central place; single-file ones
  near the top of the file.
- **Comments**: prefer self-documenting code; comment business intent (the why), not
  mechanics. Do not write a comment the code already makes obvious. See Repo-Specific
  Conventions on the cost of comments that assert behavior the code does not have.
- **Defensive logging at boundaries**: a failure at an external boundary must be diagnosable
  from its log line alone. Log the request URL at debug before sending; on failure log
  status, scoping identifiers, and a redacted body. Never silently swallow an error.
- **Sensitive values**: never log secrets, tokens, passwords, or PII. Log presence
  indicators (`token_present=true`) instead. On a response that can echo a credential (a
  login or token exchange), log a structured extract and no body. Redact a body before
  logging it, cap it first, and fail closed on anything the redactor cannot delimit.
- **Diagnostic logging**: prefix temporary lines with `DIAG_DEBUG` and remove them before
  shipping unless actively needed.

### Testing

Behavioral code changes must include tests (no size exemption). Pure config changes,
docs-only changes, and zero-behavior changes (comment typos, formatting) are exempt from the
test requirement, but never from the plan or the `/challenge-loop`. Prefer tests that
exercise real behavior end to end over heavily mocked ones; mock at external boundaries, not
at internal ones. Test files are colocated `*.test.js`; the canonical runner is
`tools/run-tests.sh` (see Repo-Specific Conventions for why a bare glob is wrong here).

### Pull requests

- Title: `<branch-name> -- <description>`. Include a link to the plan file in the body.
- Comment every significant block on the files-changed tab: what it does and why (intent,
  tradeoffs). This is not optional; a reviewer should not have to ask.
- **Kosmos has no human reviewer.** The gate is a converged `/challenge-loop` (which writes
  the pre-challenge proof the `pre-challenge-gate` hook requires) plus green CI. An agent
  merges its own green PR rather than waiting on a person, with two holds: pause during an
  active release cut, and re-verify the PR is still `MERGEABLE` at merge time (a cut can
  change what is on `main` under you). Do not add a human reviewer to a Kosmos PR.
- Reply to every review/challenge comment and resolve all threads before merge.

### GitHub issues

Every issue links back to the plan that created it (include the plan path in the body). A PR
that addresses an issue must NOT auto-close it: reference it with `Addresses #N` (or
`Re #N`), never `Closes #N` / `Fixes #N` / `Resolves #N`. The issue stays open until the
reporter/QA verifies the change on the running app and closes it. Exception: when the PR
author IS the issue author, the author closes it themselves once the change is verified
working.

### Finishing up

Before opening a PR: hydrate comments on new and touched code where intent is not obvious;
if a touched directory has a `CLAUDE.md`, keep it accurate; update this file's Module Map /
Commands / Where to Find Things if you moved files, changed commands, or added a directory;
then run `/challenge-loop` (the pre-PR gate) and `/create-pr`.

## Stack (why it deviates from a typical service)

Kosmos is plain JavaScript on Node (`node >=26`): no TypeScript, no build step, no database
server, no cloud runtime. It runs entirely on the end user's own Mac, from source, packaged
with a pinned Node runtime. So there are no compile/type-check/migration pre-PR steps; the
one pre-PR gate is `yarn test` (which runs `bash tools/run-tests.sh`).

## Repo-Specific Conventions

These conventions currently live only as tribal knowledge and code comments. Each points at
the code that enforces or motivates it, so it is checkable rather than opinion. (Sourced
from a night in this codebase, kosmos#2616.)

1. **`node --test <explicit files>`, never a bare glob. `tools/run-tests.sh` is the
   canonical runner.** A path glob like `engine/*.test.js` does not descend subdirectories,
   so a bare glob silently runs only part of the suite and still exits green.
   `tools/run-tests.sh` (around lines 170-207) counts every `*.test.js` in the tree as a
   coverage assertion and then runs that same set (`KOSMOS_TEST_FILES`), so the count and the
   run cannot drift.

2. **Sandbox every root before any `require`.** Roughly two dozen modules freeze `store.ROOT`
   at require time (the ONE data-root derivation, `engine/store.js`, kosmos#1848/#1856). Set
   the `AGENT_WORKFORCE_*` root env before the first `require` of a store-using module, or
   the module captures the wrong root. `engine/store.js`'s header documents the
   require-ordering trap.

3. **Destructive/live actions fail closed by default; production opts in once.** A module that
   performs a real side effect (a `launchctl`/`tmux kill-session`, a delete) calls
   `engine/live-execution.js`'s `liveExecutionAllowed()` and, when it returns false, calls
   `refuseOrWarn(...)` to refuse rather than act (#1598). The flag is a module-level
   `allowed=false` that only `allowLiveExecution()` flips, and only `server.js`'s real-startup
   path calls it (`server.js` around line 10656). A `node --test` process is detected by
   `process.execArgv` containing `--test` (deliberately NOT `require.main === module`, and NOT
   an env var, which children inherit), so an in-process test never has live execution armed and
   `engine/remove.js`, `update.js`, `create.js`, `delete-leftover.js`, and `win32stop.js` refuse
   instead of faking success. Preserve this: gate any new destructive action behind
   `liveExecutionAllowed()` and never let it fire at module load. Enforced by
   `engine/create.live-gate-1598.test.js`, `engine/update.livegate-1726.test.js`, and
   `engine/platform-gate-wiring.test.js`.

4. **A committed `web/` change needs a `docs/browser-checks/` assertion or a
   `Browser-check: <reason>` trailer.** `tools/run-tests.sh` (around lines 213-222, via
   `tools/lib/browser-check-gate.sh`) refuses a branch that changes a rendered surface without
   either updating a browser-check assertion or carrying the explicit trailer, so an
   unasserted rendered surface cannot merge.

5. **Two derivations of one fact is this codebase's most-shipped defect.** When two places
   compute or state the same thing (for example the account routes copying an enumeration but
   sharing the sentences), they drift, and the drift ships silently. Prefer one source of
   truth that both sites read; if you must duplicate, add a test that pins them equal. A
   comment that asserts behavior the code does not have is the same defect in prose: state
   what the code does at the code, and put reasoning that can go stale in the commit or plan.

### This list is intentionally incomplete

These five come from the account and removal lanes one agent happened to be in. They almost
certainly miss what the frontend and installer lanes would each put first. This section is
meant to grow: if you work in a lane not represented here and trip over a convention that
lives only in your head or a code comment, add it here (sourced to the enforcing code) rather
than leaving it tribal. Adding a convention is a normal PR, not a special event.
