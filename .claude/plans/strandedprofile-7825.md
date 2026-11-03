# strandedprofile-7825: clear settings stranded with no folder or job

Card: joshualeestone/kosmos#7825 (Renet Tilley, night shift 11-02). Follow-up to #7819 (PR #7829); stacked on it.

## Why
`delete-leftover.plan()` refused "nothing of X is left" whenever there was no folder and no job, before it looked at
stored records. So a profile (and picture) left by a delete from before #7819, or by a #7819 PARTIAL, could not be cleared
through the product, and a new agent under the name inherited the old `id` and fields (`writeProfile` keeps a stored id,
#170). Seen live: `profiles/b55-1.json` on the Windows box.

## The call
With no folder and no job, `plan()` now looks at the name's stored records (same `namedRecords` as #7819). None, or held
for another agent under the same stored name: unchanged, "nothing left". Otherwise offered, unless `strandedRefusal` says
they are somebody's on purpose:
- a world start waiting to retry: the name (or a same-stored-name spelling) is in `world-starts.json`
  (new `worldstarts.pendingNames()`). Not `policyHeld` alone (round 1);
- a connected agent whose recorded folder is outside the workers folder and out of reach (an unplugged disk or share);
  a recorded folder inside the workers folder that is gone counts as left over;
- a record that cannot be read refuses, as every failed look in plan() does.
Sentences are about the records only ("Move its settings and picture to the Trash"; for good without a Trash, and then
the name must be typed). The #7819 PARTIAL now ends "Deleting what is left again clears them", since a retry is reachable.

Rejected:
- Clearing stale profiles in `create`: create cannot tell a stale profile from worldstarts' deliberate one (same reason
  #7819 gave).
- A separate "clear settings" verb or route: the existing plan/del pair, its route and both UI entry points (agent page
  box, removed list) already paint whatever the plan says, so one engine change reaches the product.
- Treating any `dir` as "still somewhere": a folder recorded inside the workers folder that is gone is exactly the
  #7819-era leftover.

## Weakest premise
That world starts (including their policy holds) are the only places a profile is written on purpose before a folder exists. Swept:
every `writeProfile(` caller in engine/ and server.js; the others write for an agent that already has a folder or is
connected (discover writes `dir`, handled by the out-of-reach rule). A future writer of a pre-folder profile would be
offered for deleting.

## Tests
engine/delete-leftover.test.js, nine kosmos#7825 tests: done-when (stranded profile and picture offered, to the Trash,
new agent gets a new id); CONTROL nothing stored; pending world start refused and kept (CONTROL without the record
offered); world start in another case; policyHeld (CONTROL unheld); unreadable record; out-of-reach folder (CONTROL gone
folder inside the workers folder); no Trash (typed name, for good); shared stored name with a running agent.
Mutations (each reds its own test): world-start check, case-key match, policyHeld, unreadable record, out-of-reach dir,
never offering at all.

## Review round 1 (opus, fixed)
- The profile is read directly: store.readProfile answers {} for an unreadable or non-JSON file, so an unreachable
  connected agent's profile at mode 000 was offered. Now any failed read refuses.
- policyHeld alone no longer refuses: removal drops the world-start entry and leaves the mark, and Repair cannot start a
  name with no folder (create.installJob), so a marked profile with no entry is stranded. The world-start record decides.
- A records-only delete whose settings will not move no longer retires the community account (a retry is offered now,
  so retiring while nothing was deleted would be the one irreversible step of a REFUSED delete); it says "Nothing was
  moved" and that deleting again clears them.
- Settings kept for another agent under the same stored name get their own sentence instead of "nothing left".
- Grammar of the PARTIAL join ("Its settings are gone").
- Tests added: unreadable and non-record profile, records-only community wording plus token revoke plus retire, stuck
  records-only (no retire), Linux arm. Each fix mutation-checked.
- Deferred: a recorded folder compared by path.resolve, not realpath (a symlinked workers path reads as outside and is
  refused: the safe direction).

## Review round 2 (sonnet)
- BLOCKER, accepted and SPLIT: a stranded name is not reachable on screen. The agent page box needs a card and the
  removed list needs a removal record, and a stranded name (no folder, no job) has neither once del() forgot the record.
  The call: two PRs under this card. This one keeps the removed-list record when settings or a picture would not move
  (forgotten only once they went), so the PARTIAL's "Deleting what is left again clears them" is reachable through the
  removed list's row. The second PR lists names stranded BEFORE #7819 (b55-1) in the removed list (server + web), and
  the card stays open until it merges. Rejected: adding profile-only names to the board's offline roster, which is read
  every 5 s poll and would draw a card with Start and Repair controls that cannot work without a folder.
- A file that reads but is not settings gets its own sentence, not "try again" (it is not a passing fault).
- A folder recorded inside the workers folder in another case is inside it on a case-blind disk.
- Tests: the kept row and the retry through it; damaged settings sentence; relative dir; case-blind fold with a Linux
  CONTROL. Each fix mutation-checked.
- Weakest premise, added: a world start registered between del()'s re-plan and its move is not seen (the usual
  plan-then-act gap, narrowed by the re-plan).

## Review round 3 (opus, fixed)
- The retry sentence is promised only when the removed list's row exists (remove.isRemoved after the step): an agent
  deleted from its own page that was never removed has no row and, with its folder gone, no page. That case is left to
  PR 2, which lists every profile-only name, not only pre-#7819 ones.
- Pinned: a folder or auto-start file that will not go still drops the removed-list record (the card is the way back).
- Two comments the move made false (the standing reset's reason; "unlike forget above"). Plan lines on policyHeld.
- Declined: capitalising the community-only `because` start; every `because` here starts lower case by convention.
- Each fix mutation-checked (kept row, dropped row on folder/job stuck, door, no door).

## Review round 4 (sonnet, fixed)
- The recorded folder is compared as the disk spells it: the nearest existing part resolved through links and the
  disk's case, the gone rest joined on (a link or /var vs /private/var read as "cannot reach", stuck for good).
- A settings file that reads but is not settings is offered (it was a dead end): it cannot be a world start's (the
  record is still checked), every reader already treats it as empty, and the plan says it could not be checked.
- Taken out again: round 2's separate case fold. With the link-resolving compare it changed no outcome (its mutation
  stayed green), so it was an unarmed guard.
- Picture-only wording pinned end to end. Each fix mutation-checked.
- Declined: a create-in-flight guard (create writes the profile after the folder, create.js:7205, so a name mid-create
  has a folder and never reaches this path); win32 records-only test (the records-only arm has no platform branch: no
  job, so win32job is never asked).
