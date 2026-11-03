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
