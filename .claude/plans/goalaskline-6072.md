# goalaskline-6072: the project page says when the Assigner gave up on its goal today (#6072 slice 2)

Stacked on goalaskgaveup-6072 (slice 1: GET /api/projects carries `goalAskGaveUp`). Rebased onto main once slice 1
merges. Card: joshualeestone/kosmos#6072 (the measured premise and the call are on it).

## The call
- web/index.html: one status line under the project's name, beside the paused line (`pj-one-goalask`, the same
  `dhint` style), painted by `paintGoalAsk(p)` from the project the page already holds (it polls /api/projects; card
  comment 6156864486). Words: "Kosmos could not reach <agent> to plan the next work toward this project's goal (<n>
  tries in the last day). It will try again later; to start sooner, give the project a task."
- Hidden when the project carries no give-up, and on a read that failed (a line from a read we could not make would
  claim what we cannot see). The board already hides it for a paused or archived project, open work, an agent no
  longer on it, a goal gone from BRIEF.md, or a day old (slice 1).
- Not the Issue pill (Issue is an agent needing the person, #4730), not the project tile (Josh's #747/#748 layout).

## Proven
- web.goalask-line-6072.test.js (the page's real function, lifted): the line names the agent and the try count; no
  line with no give-up, and it clears when the give-up goes (control: it shows first); no line on a failed read; the
  name is set as text, never markup; the element sits beside the paused line as a status.
- web.project-pause-head-5391.test.js still passes (the neighbouring line).

## Review 1
- [BLOCKER as reported] the line missed the new look's own-row rule (flex: 1 0 100%) the paused line has --> added for
  parity, and docs/browser-checks/render-onhold-4771.js now renders it (injected on the board's own /api/projects
  answer) at light 1400 and dark 390: it shows, takes its own full-width row, and goes once the give-up does.
  Measured: removing the rule still passes at both widths, because a sentence this long cannot sit beside the title
  row, so the reported squeeze does not happen with these words. The row check therefore does not test the rule (said
  in the check); the rule is kept for parity with the paused line.
- Review 2: the block put the page in the new look and left it there; it now restores the look it found. The surface
  gate mapped 'pj-one-view' to render-shell-noscroll-4872.js: run with this change, 72 of 72 pass, so a per-check
  trailer says so.
- [WARNING] rewritten on every 5 s poll, so a status line re-announced --> FIXED (written only on change; tested).
- [WARNING] "today" / "tomorrow" were not what the board knows --> FIXED ("in the last day", "will try again later").
- [WARNING] call sites unguarded --> FIXED (source pins on both, plus the render check).
- [CONVENTION] spacing differed from the paused line --> FIXED (same pj-paused-line class).
- [NIT] a defaulted count --> FIXED (shown only for a whole-number count; "1 try" singular).

## Review 3
- A give-up whose cause is Kosmos's own ask throwing ('threw') said "could not reach" the agent, blaming it: now
  "could not ask" (tested, with the could_not control).
- The render block is in try/finally, so a throw inside cannot leave later checks on the faked answer or the new look.

## Weakest premise
"It will ask again tomorrow": the next goal ask is due a day after the last try (GOAL_ASK_MS), but only if an idle
member and a goal are there then. And "give the project a task" is the person's lever because open work switches
the goal ask off and the Assigner can hand that task out.
