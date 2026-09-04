# Daily product-feedback report, slice 2: the agent-authoring trigger (kosmos#2037)

Builds on slice 1 (PR #2123, merged): `engine/feedback.js` (the always-on local
store) + `/api/feedback` GET/POST. Splinter assigned slice 2 = "the part that
actually generates the daily product-feedback content into the local store."
Still NO send, NO privacy surface, so merge-on-green like slice 1.

## The two halves of the trigger

1. **A write PATH the agent uses.** `POST /api/feedback` already exists, but agents'
   natural interface is the `kosmos` CLI (`kosmos post`, `kosmos msg`, `kosmos report`).
   This slice adds **`kosmos feedback`** (write from stdin/args, show, list), calling the
   local `engine/feedback` DIRECTLY via `node -e` (the store is local, so this works even
   when the board is not running, and needs no token round-trip). Same node-e-require
   pattern the CLI already uses for `store.ROOT` (install/kosmos:307).
2. **The daily instruction (the actual "trigger").** A standing direction to the
   designated agent (the PM) to author a daily report of what did not work + suggestions,
   using `kosmos feedback write`. Daily cadence via self-check: write today's report if
   `kosmos feedback` shows none for today. This is the softer, copy-bearing half.

## Decisions (mine, per Josh's "make the call and implement")

- **Write path = a CLI verb, engine-direct.** Robust to a down board; matches how agents
  already author. Local-only, no send.
- **`kosmos feedback write`** reads the report body from STDIN (so an agent can pipe a
  multi-line markdown report) or from the remaining args; `show [date]` prints a day's
  report; `list` prints the available dates. Errors are the CLI's plain `say` sentences.
- **The instruction targets the PM/report-writer role, not every agent**, matching Josh's
  "probably a project manager". Copy stays in his frame: "what did not work" + "suggestions
  to make it better", authored locally, sent only if the (future) switch is on.

## Slice-2 scope + sequencing

- **This branch (2a): the `kosmos feedback` CLI write path + a bash test.** Concrete,
  unambiguous, testable, no decision surface. Ships merge-on-green.
- **2b (next, same slice): the standing instruction + daily self-check cadence.** Lands the
  "trigger" proper. Kept separate because it is behaviour-changing (an agent doing a new
  daily thing) and carries copy; still no privacy surface, still merge-on-green.
- **HOLD (later slice, NOT this): the SEND layer** (scrub + gated transmit). Splinter's
  standing instruction: bring him the design (what is scrubbed, what is sent, the gate)
  BEFORE it ships. Not touched here.

## Rejected

- **Make the agent POST to /api/feedback instead of a CLI verb.** Works, but needs the
  board up + the agent token, and is a clumsier authoring interface than a `kosmos` verb.
  The CLI verb is engine-direct and board-independent.
- **Build the instruction/cadence in THIS branch too.** Kept to 2b so the concrete write
  path ships clean and the copy-bearing half gets its own focused review.

## Verification

- A bash test (tools/test-feedback-cli-2037.sh style) driving `kosmos feedback write`
  (from stdin + args), `show`, `list` against a sandboxed store, asserting round-trip,
  the empty-body refusal, and that `write` with no board running still works (engine-direct).
- `node --check`-able wiring; the full suite + test:shell via the challenge-loop validation.
