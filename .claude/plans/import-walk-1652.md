# Plan: the #1652 import-flow headless browser walk

## What this is

kosmos#1652 (import my existing agent) is BUILT and merged (#1939: `/api/agent-import`
parses a raw CLAUDE.md; `importLoad` in web/index.html lays the parsed fields onto
the create form). The only remaining step (Josh, 2026-09-25 "make it visible") is a
live import-flow browser walk that confirms the flow WORKS, specifically that the
create-instr textarea actually fills. No `node --test` can see a textarea's value.

## The check

`docs/browser-checks/import-agent-flow.js`, headless, two arms:
- POSITIVE: paste a valid agent file, press "Bring it in", assert name + role label
  + the instructions TEXTAREA fill and the flow advances to the name step. This is
  the fill-defect guard.
- NEGATIVE (control): a non-Kosmos file is refused WHOLE, names a reason, stays on
  the import panel, leaves the textarea EMPTY. Without it the positive arm could
  pass on a flow that fills from anything.

## Decisions

- Completes first run via `/api/first-run/complete` before driving the picks: the
  launch cover (#boot-cover) and first-run overlay (#firstrun) intercept pointer
  events on the create picks, and Escape does not reliably clear them for the
  create flow (only for read-only views like render-agent-lines.js). Measured.
- Does NOT press Create: import parses, it never creates (web/index.html's own
  comment), so the walk spawns nothing and needs no dry-run guard. The real Create
  is render-create-made.js.
- Takes the board URL as argv[2], like the other create-flow checks; the sandboxed
  board is the recipe's responsibility (README).
- Registered in the README table (the browser-checks-indexed test enforces that
  every check is named there).

## Verification

- Runs headless from a plain session (NODE_PATH=~/work/pw-runtime/node_modules, no
  MCP/claude-fe). Verified in-session that chromium launches headless and the walk
  passes 8/8 against a sandboxed board.
- Non-vacuity: perturbation-checked. Breaking the create-instr fill in web/index.html
  turned the textarea assertion red (7 passed, 1 failed), then restored.

## Weakest premise

The walk asserts the create form fills, not that a subsequent real Create persists
the imported agent. That is deliberate (import parses, never creates; the create is
render-create-made.js), but it means "import works" here is scoped to parse+fill,
not to a created-and-running imported agent.
