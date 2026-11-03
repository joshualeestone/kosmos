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
  has a folder and never reaches this path); a win32 records-only test (the records-only arm adds no platform branch: on
  win32 it is reached only after win32job.presence answers known and not registered, an arm the existing #570 tests
  pin; after that the records path is the same on every platform).

## Review round 5 (opus, fixed)
- A recorded folder outside the workers folder that IS there (a link or a file; a real folder never gets here, since
  workerDir follows it and the folder rule refuses first, measured) no longer gets "cannot reach, perhaps a disk": it
  gets the folder rule's own wording.
- The plain spelling is compared first (against the workers folder as written and as resolved), so a folder on a gone
  share is resolved only when that fails. Not a new exposure: workerDir already lstat'ed it in the same plan().
- The damaged-file line says "not in a form Kosmos can read" (it was read; it is not settings).
- Weakest premise, added: on a case-sensitive disk a damaged profile shared by key with a stopped agent connected outside
  the workers folder (Miles vs miles) is offered under the other spelling. Accepted: the file is already empty to every
  reader, and it goes to the Trash.
- Each fix mutation-checked (link resolve, "there" sentence, plain-only compare).

## Review round 6 (sonnet, fixed)
- A recorded folder inside the workers folder by its spelling is trusted only when no part below the workers folder is
  a link: a dangling link (a disk not mounted) is out of reach; a live one is judged by where it goes. A look that fails
  there refuses. Both mutation-checked.
- The case-fold test is skipped on a disk that tells case apart (CI may be one).
- Answered, no change: "the retry relies on PR 2". It does not: the removed list draws "Delete its files" on every
  removed row whatever is left (web/index.html removed-row template), and the plan is fetched on the click, so the
  kept record is a reachable retry today. PR 2 is for names with no removal record.
- Declined: the "loses" list carrying the damaged-file line (it is what the person should know before the click, the
  list's purpose); punctuation-variant world-start test (same safeKey path as the case test).
- Weakest premise, added: a recorded folder written with ".." after a link is judged by its normalised spelling;
  Kosmos writes recorded folders already resolved (discover writes the folder it was given, absolute).

## Review round 7 (opus, fixed by replacing the check)
- Three ways around round 6's walk (a different-case spelling skipped it; it stopped at the first live link; a file on
  the way refused forever). Third patch in a row on one check, so it was replaced: resolveRecordedFolder resolves the
  recorded folder one part at a time from the root, following every link wherever it sits; the first missing part
  (ENOENT, or ENOTDIR under a file) and the rest are the gone rest; a dangling or looping link is its own refusal; the
  existing part is resolved once more so its case is the disk's. Then one compare against the resolved workers folder.
- Sentences: a dangling link says it leads nowhere; an outside folder that is gone says it is not there now and may be
  on a disk that is not connected (true whether the disk is unplugged or the folder simply went).
- Dropped with it: round 5's plain-spelling-first shortcut. The whole path is lstat'ed part by part, as workerDir
  already lstat'ed it in the same plan(); a hung share costs what it already cost.
- Tests: two links (live then dangling), another case (case-blind disk only), a loop, a file on the way. Every branch of
  the resolver mutation-checked (ENOTDIR, following links, final resolve, dangling vs unlookable, failed look).
- Declined: naming the revoked tokens in a records-only REFUSED sentence (they are inert for a folderless name, and the
  person acts on what stays, which the sentence names).
