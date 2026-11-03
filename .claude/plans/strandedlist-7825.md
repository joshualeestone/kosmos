# strandedlist-7825: show names with only settings left in the removed list

Card: joshualeestone/kosmos#7825, PR 2 of 2 (Renet Tilley, night shift 11-02). Stacked on PR 1 (strandedprofile-7825),
which made plan()/del() offer a name's stored settings and picture when nothing else is left.

## Why
PR 1's review round 2: the engine offers the delete, but a person cannot get to it. The agent page box needs a card, and
the removed list needs a removal record; a name stranded by a delete from before #7819 (b55-1 on the Windows box) has
neither, so nothing on screen ever asks the engine.

## The call
- Engine: `delete-leftover.settingsLeftovers()` lists the names whose profile stands with no folder, a job known to be
  absent (`job === false`; "could not look" is left out), not on the removed list, and no world start waiting under the
  stored name. Built on `register.survey()`, the same reader Repair and the board's offline rows use, so "no folder, no
  job" means one thing everywhere. A failed read lists none and says so (`ok: false`).
- Server: `/api/removed` carries them as `leftovers: [{ name, shownAs }]`, beside `agents`. Omitted when the read
  failed, so the screen draws nothing rather than a false empty list. Remembered for 15 s (the list repaints every 5 s
  on the Agents tab and survey reads every job), and forgotten on any delete.
- Web: the removed list shows each as a row, "Only its settings are left", with the existing "Delete its files…"
  door (data-delete-leftover, which fetches the plan on the click and paints a refusal as a sentence). No Restore:
  there is nothing to restore. The section shows when either list has rows; the count is both.
- Not filtered by the recorded-folder rule in the list: that look can block on a share that is gone, and the list is
  polled. The click asks plan(), which refuses with the true sentence.

Rejected:
- The board's offline cards (PR 1 round 2): read every poll, and a card offers Start and Repair, which cannot work
  without a folder.
- Calling plan() per name in the list: it reads the pane roster and resolves recorded folders, per name, per poll.

## Weakest premise
That `job === false` from survey's jobReader is reliable on every platform; where it answers null the name is left out,
which hides a real leftover rather than offering a wrong one.

## Review round 1 (opus, fixed)
- A running agent (its folder can go while it runs, #127) is left out, case-blind where the disk is; a failed roster
  read lists none.
- A profile recording a folder outside the workers folder is left out, read from the profile and never looked at (so
  a share that is gone cannot block the poll).
- The list reuses the board poll's survey when it is under 10 s old, so jobs are not read twice per poll.
- A failed read is not remembered on the server, and the page keeps the leftover rows it last drew when the field is
  absent (one bad read no longer hides a row a person is reaching for).
- The toggle no longer calls these removed: "Show what is left of past agents (N)", or "Show removed agents and what
  is left of others (N)" with both.
- Engine and page fixes mutation-checked (running, outside, case fold, roster failure, survey reuse, keep-last, label).
  REASONED, not measured: the server not remembering a failed read (no route-level way to fail the read in the test).
- Declined: "settings and picture" wording (a picture reads as part of its settings); clearing the memo on connect and
  world-start writes (a stale row lives at most 15 s and its click refuses with a true sentence).

## Review round 2 (sonnet)
- BLOCKER, fixed: a delete cleared the remembered list but not the poll's survey, which was taken before the delete and
  reused, so the deleted name was listed again for 15 s. The delete now clears both. The route test polls the board
  first, and reds without the fix.
- Fixed: the page drops a just-deleted name from the kept rows, and kept rows expire after a minute without the field.
  Browser-check arms for both, each mutation-checked; README controls re-measured.
- Declined: clearing the memo on create, restore and remove (a stale row lives at most about 25 s and its click
  refuses with a true sentence; create writes the profile last, create.js:7205, so a half-made agent is not listed);
  a failure cache (a failed read costs one survey per poll, as the board's offline rows already pay).

## Review round 3 (opus, fixed)
- The poll stores its survey for reuse only when it read cleanly (a failed one stopped /api/removed trying its own for
  10 s). REASONED, not measured: no test fails the poll's survey.
- The outside-folder exclusion compares against both spellings of the workers folder (as written and resolved), so a
  real leftover recorded under /private/var for /var is not hidden. Arm added; mutation reds it.
- The route test moved above the #2615 comment it had split from its test.
- README says what the page does (same door, its own label); each leftover button is named for its agent; the page's
  delete filter matches names case-blind.
- Declined: a divider before the leftover rows (the hint names folders and removed agents; each leftover row says what
  it is).

## Review round 4 (sonnet, fixed)
- Rounds 2 and 4 pulled opposite ways (kept rows must not pass for current for ever; dropping them reads as "none").
  The call: keep the rows while the board cannot look, and after a minute add a line saying they may be out of date.
  Arms: no stale line on a fresh failure, stale line after a minute with the rows kept; three mutations each red one.
- A failed server read is kept 5 s (was: not kept), so a lasting failure does not run every job on each poll.
  REASONED, not measured.
- Answered, no change: "the route test may not reach the survey reset". Measured in round 2: removing the reset reds it.
- Declined: dropping data-shown-as (the sibling rows carry it; one shape for both), a sub-heading for leftover rows
  (each row says what it is), clearing #removed-msg (existing behaviour of the shared region).

## Review round 5 (opus, fixed)
- The kept leftovers are updated only after the paint knows its answer is the current one, so an older answer that a
  newer paint replaced cannot put back a name the delete just dropped. REASONED, not measured (a race the check does
  not stage).
- The route test asserts the read after the delete succeeded before asserting the name is gone (it could pass on a
  failed read). The stale line says "has not been able to check for a while". The route comment names the 5 s keep.
- Declined: case-exact delete filter on Linux (the next good read redraws a wrongly dropped row); filtering only on
  "deleted" (a partial's sentence already names what stayed); the negative arm's hidden-list contents (pre-existing).

## Review round 6 (sonnet, fixed)
- A first load whose leftovers read fails, with nothing removed and nothing kept, hid the section without a word. The
  shared #removed-msg line now says Kosmos could not check, written only into an empty line and taken down by a good
  read only if still ours. Two arms, each mutation-checked.
- Stale-line copy: "has not been able to check for leftover settings in a while".
- Answered, no change: the round-5 reorder (every return path checked by the reviewer, no read-before-set).
- Declined: an off-tab arm (the update sits after the token check and before the tab gate, both read in one place);
  dropping the cache on create and restore (a stale row's click refuses with a true sentence, as rounds 2 and 4 said).
