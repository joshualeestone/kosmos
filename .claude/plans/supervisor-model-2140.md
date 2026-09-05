# #2140 slice: guard the runtime model-launch link (agent-supervisor -m/--model)

## Context — the persistence chain, audited

The #2140 persistence-hardening slice asks: save a model per agent, and pass that
exact selection into the runtime. A read-only audit of the full chain found it is
**already correct end-to-end**:

1. **Save (create)**: `body.model` → validated against the account's live runnable
   set via `runnableAllowlist` (fail-open) → forwarded to `create.createAgent`.
2. **Resolve**: `engine/create.js` OpenAI arm sets `modelArg = id` verbatim (the
   exact chosen id, not remapped through the static Claude MODELS table).
3. **Persist**: written to the launchd plist's model slot (`$6`), the same slot
   Claude uses; read back by `readJob` (`model: args[7]`).
4. **Launch**: `bin/agent-supervisor.sh` passes it to the runner — codex as
   `-m "$MODEL"`, claude as `--model "$MODEL"`; an empty MODEL passes no flag
   (the intended "Let OpenAI choose").

No default silently overrides a stored selection.

## The gap this closes

The create→plist end is already guarded by `create.test.js` ("#2140: an OpenAI
agent can be CREATED on a chosen model ...", asserts the exact id in the plist
`-m` slot, empty = auto, malformed = refused). But the **last link** — the
supervisor actually passing that id into the runtime — had no test. A regression
there (dropping `-m`, or applying a default) would ship silently.

## The change

`tools/test-supervisor-model-2140.sh`, wired into `package.json`'s `test:shell`
(grouped with `test-supervisor-wait.sh` / `test-supervisor-env.sh`). It mirrors
`test-supervisor-env.sh`'s harness: a sandbox copy of the real
`bin/agent-supervisor.sh` beside a stub `tmux` that records the `new-session`
argv, then asserts on that argv:

- **codex + chosen model** → `-m` present, the exact id (`gpt-4o-2024-08-06`, a
  dated snapshot, so "verbatim" is exercised) present, the codex bypass flag
  present, and `--model` absent.
- **codex + empty model** → no `-m` flag (auto), runner still launched.
- **claude + same model (control)** → `--model` present, `-m` absent — the
  discriminator proving the codex `-m` is arm-specific, not something any runner
  would produce.

## Why a control, and why it can fail

The claude control is what makes the codex `-m` assertion meaningful (a bare
"codex passes -m" could pass for the wrong reason if every arm did). The guard
was verified armed: removing `-m "$MODEL"` from the supervisor's codex arm reds
the `-m` assertion.

## Weakest premise

The test drives a sandbox COPY of the supervisor against a stub tmux; it proves
the supervisor BUILDS the correct launch argv, not that a real codex process then
honors `-m`. Honoring `-m` is codex's own contract, out of scope here; the booted
board end-to-end confirmation (a real codex launch whose argv carries `-m <id>`)
remains the box-dependent verification noted on the card. This slice closes the
argv-construction gap, which is the part a code change in this repo could break.

## Not in scope

No engine/behavior change — this is a test-only regression guard. The create→plist
and change-model paths were already correct and guarded.
