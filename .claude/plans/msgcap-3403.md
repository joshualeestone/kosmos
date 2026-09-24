# msgcap-3403 -- raise the agent-message cap + soft near-limit counter

Card: kosmos#3403 -- "Raise the 2000-char message cap to agents (UI maxlength + engine
MESSAGE_MAX), stop the silent cutoff." Josh hit the old 2000 cap writing a message to an
agent and was cut off mid-message with no warning.

## What finished looks like

- An agent-message composer no longer stops the person dead at 2000 chars, and when they do
  approach the cap they get a soft warning rather than a silent cutoff.
- The UI cap and the engine cap stay matched (no UI that lets a person type more than the
  engine will accept, and no UI that caps far below what the engine allows).

## Decisions (mine, per Josh's standing "make a recommendation, implement it, continue" ruling)

1. **Value = 10000.** Josh's stated floor on the card was "much higher e.g. 10k+, or
   effectively unlimited." 10000 is the clean value at that floor. Rejected: the interim
   8000 (below his floor); "effectively unlimited" (a message fans out into agent panes, so
   an unbounded body is a footgun and the soft-counter UX assumes a finite cap). Weakest
   premise: that nothing above 10000 imposes a hard transport limit -- checked: the #3419
   paste transport chunks the body at 256B so length scales, and the win32 channel
   MAX_REQUEST_BYTES is 128 KiB, far above a 10000-char message.

2. **Engine cap = chat.MAX_TEXT.** The card said d-say's 2000 was matched to
   `engine/tasks.js MESSAGE_MAX`, but that is the TASK-message path. The agent-message
   composers (d-say, d-term-say, pj-say, pj-post) actually validate through
   `chat.messageProblem` (`chat.MAX_TEXT`). Raising `chat.MAX_TEXT` to 10000 lifts the
   engine cap for all four at once. `tasks.js MESSAGE_MAX` (tk-say and the task composer) is
   a separate cap and delivery path, left at 2000 -- not the composer Josh hit, and raising
   it needs its own task-delivery transport-safety check.

3. **Scope of this PR: the two MULTI-LINE message composers.**
   - **d-say** (agent Talk) and **pj-post** (project room): maxlength -> 10000 + the soft
     near-limit counter. Both are textareas that ride `pjGrowComposer` on every value change
     (type, draft restore, send/reset), so the generic counter updates on every path with no
     per-site wiring.
   - **pj-say** and **d-term-say** (single-line quick inputs): left at 2000 this PR. Their
     `.value` is set directly on several scattered clear/restore sites, so a correct counter
     there needs per-site wiring and its own coverage -- a clean follow-on. The soft counter
     belongs on the composers built for long messages. (Their engine cap is unaffected;
     nothing silently rejects at the server.)

## Implementation

- `engine/chat.js`: `MAX_TEXT` 2000 -> 10000 (via an interim 8000), with the rationale in
  the comment. `engine/chat.test.js`: cap assertion -> 10000.
- `web/index.html`:
  - d-say + pj-post `maxlength="10000"`.
  - `pjComposerCount(el)`: a generic soft counter. A composer opts in by shipping a sibling
    `<id>-count` block AFTER its `.composerbox` (NOT a flex child of it -- `.composerbox` is
    display:flex with no wrap, so a full-width child is squished inline). Reads the cap from
    the element's own `maxlength`, shows within 500 of the cap, turns amber (`--warn-ink`)
    within 100. Called from `pjGrowComposer`, guarded with `typeof` so the JSDOM lift test
    that eval()s `pjGrowComposer` in isolation does not throw.
  - `.cpost-count` CSS: a right-aligned block line below the composer.
  - Counter elements `#d-say-count` and `#pj-post-count`.
- `docs/browser-checks/render-msg-counter-3403.js`: new hermetic (server + fixture agent)
  browser check. Drives the real d-say (both themes) and pj-post (once), asserting: the cap
  control; hidden empty and hidden far from the cap (the setup control); appears at 500 left
  with the right text; amber (a real computed-colour change) at 100; singular "1 character
  left"; "0 characters left" at the cap; hides on clear; a GEOMETRY arm (own line below the
  input, full-width right-aligned -- a text-only check passes on the squished-inline bug);
  and a real-keystroke arm on d-say. Wired into the runner, README, and reason-grep count
  (128 -> 129). Surface-gate overrides for render-type-to-focus-3283 + render-composer-stroke
  (the pj-post/d-say tokens they map; their behaviour is unaffected by a maxlength change and
  a sibling counter element).
- Stale prose refreshed where the cap raise falsified it (chat.js, server.test.js,
  win32channel.test.js comments).

## Verification

- `render-msg-counter-3403.js`: 44 assertions PASS headless, both themes + pj-post.
- `web.composer-height-1303c.test.js`: 4/4 (fixed the lift-in-isolation ReferenceError).
- Full `bash tools/run-tests.sh`: green apart from contention flakes on a busy box.

## Follow-on (to file)

- pj-say + d-term-say cap + counter (single-line quick inputs; needs per-site clear/restore
  wiring).
- tk-say / task `MESSAGE_MAX` raise (needs its own task-delivery transport-safety check).
