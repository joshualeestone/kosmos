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
  (new `worldstarts.pendingNames()`), or the profile carries `policyHeld`;
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
That world starts and policy holds are the only places a profile is written on purpose before a folder exists. Swept:
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
