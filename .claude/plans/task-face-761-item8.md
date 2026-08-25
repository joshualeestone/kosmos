# Plan: task-face-761-item8

Josh, 2026-08-24 21:56, item 8 of #761: "A task shows the assignee's face,
and under it the status (not started, waiting on me, there's an issue);
'we could not check' is not a status a person can use. Multiple
assignees, as the pack drew."

Splinter's board reconciliation (03:14) confirmed this card as mine, in
progress, do-not-route.

## Scope

1. Face instead of a colored-letter chip, on the project page's task
   cards (`paintProjectTasks` in `web/index.html`).
2. Status under the name, not inline with a dot.
3. The unknown-claim state (`t.claim.claimed === null`) stops showing the
   generic "we could not check" and shows the engine's real `because`
   instead. Splinter's heads-up (02:55) caught the wrong build before it
   shipped: the fix is not to drop the third state (that would collapse
   "checked, nothing started" and "could not check" into one appearance,
   the same defect as #805), it is to stop discarding the reason the
   engine already computed.
4. Multiple assignees, drawn from `t.parts` (already served by
   `engine/projects.js`'s `withParts`), one face+name row per part
   including an unassigned one, with an "N of M assigned" count off
   `t.progress.assigned/total`.

## What was NOT built, and why

The pack (`kosmos-app-style.FROZEN-2026-08-22.html`) shows exact strings
"Not started" / "Waiting on you" for the single-assignee case. No engine
field computes that vocabulary -- `t.claim` (self-report reachability,
`commitments.js`) and `t.progress` (parts done/closed, `progressOf`) are
both real but neither one is that axis. Inventing a mapping client-side
would be fabricating business logic that belongs in `engine/tasks.js`,
not a frontend judgment call. Shipped instead: the existing, honest,
already-hedged self-report vocabulary ("says it is on this" / "says it is
not on this" / the real `because` for the unknown case), which satisfies
Josh's actual complaint (an unusable non-answer) without inventing a
vocabulary nobody computed. Flagged for Angel/Josh if the richer
progress-state vocabulary is wanted later -- that is an engine decision.

## Steps

- [x] `tkFace(p, sessionName)`: extracted from the task detail page's
      local `faceFor`, shared by both surfaces so the face rule cannot
      drift between them.
- [x] `taskClaimHtml(claim)`: shared status-line builder, used by both the
      card list and the task detail page's per-part rows (the detail page
      had the SAME "we could not check" defect, with no distinguishing
      style at all -- found and fixed in the same pass, not left half
      done).
- [x] `paintProjectTasks`: face, stacked name/status, multi-part rows,
      "N of M assigned" summary.
- [x] Bug found and fixed along the way: the column filter used
      `t.who && !t.closedAt` -- the legacy single-assignee field directly
      -- instead of `t.progress.assigned > 0 && !t.progress.closed`. A
      task assigned only through parts (parts-first creation, no
      top-level `who` at all) silently fell out of the visible column.
      This is the exact mistake `engine/projects.js`'s own `withParts`
      comment names ("the second `t.who` gate, and it is the one that
      actually bit") -- fixed there once already, not fixed in the
      frontend's own, separate filter.
- [x] CSS: `.tkcard-who-b` (stacked name/status), `.tkcard-parts`/
      `.tkcard-part` (per-part rows), `.tkcard-status` (the count), and
      `.tkcard-part .lav.q` (the unassigned-part face's muted background,
      previously scoped only to `.tkpart` on the detail page -- found in
      self-review, fixed before shipping).
- [x] Tests: `web.task-card-761.test.js` (new, 5 tests, the card's own
      coverage), `web.task-page.test.js` (updated: the shared functions
      now need including in the test harness's constructed function
      scope).

## Independent review (self, since /code-review stalled twice this
   session in a forked-agent context -- Splinter traced this to the
   session's skills directory being missing at start, not a per-task
   issue)

- [x] Caught before it shipped: `taskClaimHtml` originally capitalized
      "Says it is on this" / "Says it is not on this". The existing
      `docs/browser-checks/render-tasks.js` regex-matches the lowercase
      form (`/says it is on this/`, case-sensitive). Reverted to
      lowercase rather than fixing the check, since the capitalization
      was a cosmetic choice with no real requirement behind it and the
      lowercase form is the pre-existing convention on `#tk-note` too.
- [x] Checked (not assumed): `#tk-note`'s own "says it is on this."
      construction is a separate, independent string build (only handles
      `claimed === true`), unaffected by the `say` -> `sayHtml` rename in
      `paintTaskPage`. Left as its own thing -- out of scope, not touched.
- [x] Checked (not assumed): the `.lav.q` unassigned-face CSS was scoped
      only to `.tkpart` (the detail page). Extended to `.tkcard-part .lav.q`
      before shipping, not left as a visual gap.
- [x] Checked: no other browser-check file references `.tkcard-who`,
      `.tkchip`, `.tksay`, or `.tkunk` beyond `render-tasks.js` (which was
      run directly and passed) and `render-url-state.js`/
      `regress-a-night.js` (both only reference `.tkcard` itself,
      unaffected by the internal markup change).

## Verification

- [x] `node --test web.task-card-761.test.js web.task-page.test.js` --
      17/17.
- [x] `npm test` (full suite) -- 0 failures, exit 0.
- [x] `bash tools/browser-checks.sh` (full suite, `render-tasks` included)
      -- all page checks passed.
