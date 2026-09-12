# #768: the task page, shaped like viewing a project (three-column reflow)

## Problem
Josh (2026-08-24, #chaoskosmos-design) called the task view a "neglected stepchild" and
asked for it to be "really formed and shaped after what a viewing of a project looks
like": who is on it down the left, the task's own activity/conversation in the middle,
the details on the right. The page was instead a two-column form (who / this task) with a
full-width activity list tacked on below. It was a form where the project page beside it
is a room.

His 2026-08-26 ruling narrowed the ask: he was describing an **appearance**, not a
membership feature. So the assignee faces get the project page's member-row treatment and
nothing is replaced; there is no new "members" concept. The design was delivered as a
published mock (installkosmos.com/design/task-page) and the spec
(`monalisa-task-page-spec.md`), and Josh's 2026-09-04 routing note assigned the BUILD to
Angel.

Prior slices already shipped: the recorded Activity list (#2400, the read-side of #992)
and the due-date field (#2403, Josh-authorized, reversing the old no-due-date deferral).
The remaining actionable slice is the **three-column reflow** itself. (The interactive
composer stays blocked on #992; a standalone members list is redundant with the parts
display for the common single-part task.)

## Approach
Reflow `#pj-task-view`'s body from the two-column `.pj2` + full-width activity section
into a three-column grid reusing the project page's visual language:

1. **Left, "Who is on it":** the task's parts (`#tk-who`), unchanged in behaviour. The
   assignee face is already `tkFace(p, sessionName)` (#761 item 8), the same element the
   project page uses, so the two cannot drift.
2. **Middle, "Conversation":** the recorded Activity list (`#tk-activity`) moves here as
   the task's conversation-so-far, followed by an honest **inert** composer that says
   writing into a task's conversation is not built yet (#992), not "coming soon". The
   folder-reveal button (`#tk-chats-reveal`) moves here from the right column, since it is
   about the conversation.
3. **Right, "This task":** project, added, state, and the due date (#2403), kept.

CSS: a new `.tk3` grid at the mock's proportions (~1 / 1.4 / 0.9). It stacks to one column
by two separate paths, because they are gated differently: a `52rem` viewport media query
stacks it on a narrow viewport (a phone), and a consolidated-layout-scoped rule stacks it
in the consolidated panel (which is floored at `60rem`, so the viewport query never fires
there; without the extra rule it would render three cramped columns in the narrow panel).
Both stacks are asserted in `web.task-reflow-768.test.js`. `.pj2` and `.tkacts-wrap`, used
only by this view, are removed.

## Key decision: keep the shipped Activity + Due, not the now-stale mock
The mock was drawn 2026-09-01, before #2400 (activity) and #2403 (due date) shipped, so it
drops both and says "a task's conversation is not recorded yet." Reality moved past it: the
lifecycle IS recorded now, and Josh authorized the due date. Building the mock's layout
faithfully while keeping the shipped content is the honest answer; blindly following the
mock's text would re-assert two things that are no longer true. This is recorded on the
card and in the commit so the divergence from the mock is deliberate, not a miss.

## Key decision: a task-specific `.tk3`, not the project page's `.pj3`
`.pj3` exists and is the project page's three-column grid, but it carries heavy
project-specific structure (`.pjsplit`, `.pjcard-members`, `.pjcard-files`) and a large
set of consolidated-layout overrides keyed on those children, none of which a task page
has. Force-fitting `.pj3` would drag in that machinery. The mock itself uses a clean grid,
so `.tk3` matches the mock's proportions and the project page's *visual language* (member
rows, tokens, rule lines) without inheriting the project grid's plumbing. `.pj3` is left
untouched, so the `web.baselines-1303a` / `web.rhythm-1303a` tests that assert on it are
unaffected.

## What must NOT change
- `paintTaskPage` and the element IDs it fills (`tk-who`, `tk-activity`, `tk-due`,
  `tk-chats-reveal`, ...): the reflow is markup + CSS only, no JS change, so the runtime
  handler test (`web.task-page.test.js`, keyed on those IDs) stays green.
- The due-date field and its round-trip (#2403).
- The parts column's interactive controls (pick-who, add-part, done/put-back).
- The `.pj3` project-page grid and its baseline rules.
- Nothing on the page says "member" (spec line 5).

## Verification
- `web.task-page.test.js`, `web.baselines-1303a.test.js`, `web.rhythm-1303a.test.js`: green.
- `web.task-reflow-768.test.js` (new): asserts both stacking paths exist (the `52rem`
  viewport query and the consolidated-layout stack rule), so the comment's claim is backed
  by a check rather than asserted.
- `browser-checks-reason-grep.test.js`: green (new `die()` lines are quotable).
- Full node suite (`tools/run-tests.sh`): green.
- `docs/browser-checks/render-tasks.js` (headless, pw-runtime): green, with new
  three-column structural assertions (`.tk3` visible, exactly three `.pjcol` children,
  activity inside `.tkconvcol`, inert composer present, page text has no "member").
- **Residual (documented, not a blocker):** a headed visual-quality pass (pixel match to the
  mock, both themes) needs the shared browser, which a bot session cannot drive headed. The
  tab-layout structure is verified headless; the consolidated layout stacks to a single
  column (a degenerate case that cannot cramp or clip), so its correctness does not depend
  on a headed check. Per the beta-merge-when-ready ruling, a headless structural pass + the
  mock as the design contract is sufficient author's evidence to ship.
