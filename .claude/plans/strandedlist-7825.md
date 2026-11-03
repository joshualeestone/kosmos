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
