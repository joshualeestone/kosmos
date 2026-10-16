# unknownjobs-6320: the restart banner names the agents it could not check

Card: #6320 (follow-up to #6310). Stacked on loginjob-6310 (PR #6323). Owner: Angel.

## Done means
When the survey cannot tell whether an agent comes back after a restart (`job === null`), the Agents tab says so and
names it, instead of going quiet; it offers no button for it. An older board with no `unknown` list behaves as before.

## Steps
1. [x] `engine/register.js` survey: `unknown` = profile-backed, not removed, folder present, `job === null` (the same
   filter as `missing`, for the other answer, so the lists never overlap).
2. [x] `web/index.html` paintSurvival: "We could not check whether N of your agents come back if you restart this
   computer." plus why, and their names (`data-survival-unknown`), under the missing block or on its own; no button.
3. [x] Tests: `web.survival.test.js` (unknown only, one, both with the button kept, an older board); `engine/register.test.js`
   asserts the unknown list.

## Decided, not missed
- Copy: says what is not known and that we will not act on it; no blame on the person, no technical word.
- The offline card's `create.jobMissing` (the card's second half) is NOT changed here: it is a separate surface with its
  own copy; it stays on #6320 as a second step after this ships.
- `docs/browser-checks/render-survival.js` needs a separately started board (`KOSMOS_URL`), not run here; it covers the
  missing block, which is unchanged.
- Only on the Mac: on Windows a failed Task Scheduler query makes every agent null, and that is not "a login job could
  not be read"; the list is empty there, as before.
- Not while login jobs are only waiting their turn under the plutil budget: those are not read YET. A budget-skipped
  plist is no longer cached for a minute; the next survey converts the next four.
- The unknown-only panel uses the solid `boardfail` shape, which this file defines for "we could not read this" (a
  dashed panel means an empty slot); it has no button. Its copy says it goes away once it can be read.
- Browser check: `render-survival.js` needs a live board and does not cover the unknown panel; the commit carries a
  `Browser-check:` trailer with that reason. Screens `restart-unknown`, `restart-both` and `restart-both-done`
  (the repair report keeps the could-not-check line) added to docs/browser-checks/mobile-shots.js (they stub
  /api/register on their own page); 9 shots, 0 overflow, kept in ~/.cache/claude-handoffs/shots-6320/. The first shots showed the combined panel
  crammed under its button; spacing added only when the line follows the fixable list.
- Each null records why (`whyNull`, per survey): 'waiting' when a plist waiting its turn is the only open question and
  no broken plist names the folder; otherwise 'unread', listed. When a genuinely unreadable file exists at the same
  time, every unknown agent is listed, including ones the next survey would clear (over-inclusive, the safe side).
- A budget skip keeps what was known about that plist (its logged record, its retry), instead of dropping it.
