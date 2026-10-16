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
