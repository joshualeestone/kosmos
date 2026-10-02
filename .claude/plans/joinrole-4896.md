# joinrole-4896: "every member shows the joining role" (kosmos#4896, second half)

Written 2026-10-01 22:57 CDT. The first half (role case) merged as #4915.

## What the report says
0.7.15 diagnostic N11: "every member shows the joining role whatever they joined to do." The report's board is not on
this machine (searched Kosmos collected-feedback, feedback, selfreports, the vault, and the handoffs: only my own notes
quote it). So the original board is NOT RECOVERABLE here; this is worked from source.

## Measured from source (origin/main a7cae2b3e)
- A membership stores only the agent's machine name (projects.addAgent, engine/projects.js ~2668). No per-project role,
  purpose or "joined as" exists anywhere: not in the record, not in the join route (server.js POST
  /api/project/:id/agent/:name reads no body), not in the CLI.
- Every surface reads the member's OWN role, keyed by sessionName: describe (projects.js ~937, profileRole(card) ||
  card.role), the project member row (web/index.html ~53511), the pickers, kosmos project show (projectview.js).
- Ruled out: a project-level role, a "member"/"joining" default, a join-time role written to all, a lookup keyed by
  project.

## The call (first pass)
Not a code defect I could find; build the GUARD. The test pins, at describe/get only (not the page's member row, the
picker, or projectview): on one project each member shows its own role, before and after another agent joins, and a
saved role wins for its member only. Mutant (describe returns the first card's role for every member): both tests red; restored, green.

Rejected: building a per-project "what they joined to do" field. That is a new feature nobody has asked for in those
words, and "never invent scope" applies.

## Weakest premise
That "the joining role" means the role shown on member rows. Two readings the code allows and this test does not
settle: (1) the agents genuinely share a role, e.g. one instruction template copied N times, whose first "You are ...,
<role>" line parses the same for all; (2) the person expected a per-project purpose, which does not exist. Either
would change my mind with the reporter's board in hand (their members' instruction files, or how they joined).

## Validation
- node --test engine/projects.member-roles-4896.test.js: 2/2; mutant 0/2.
- Picked up by tools/run-tests.sh (engine/*.test.js). Full suite before merge, through the queue.

## Review 1 found the defect, and I REPRODUCED it (23:03 CDT)
Blind review 1 (opus) reasoned, from source: connect (engine/discover.js) asks every question about the NEW name
(its job, its pane, its own profile's folder) and none about whether ANOTHER name already records the folder. So
connecting folder F as ann and then as bob succeeds, and every reader resolves both through create.workerDir to the
same CLAUDE.md: same identity line, same name and role. Measured in a sandbox on a7cae2b3e: ann ok, bob ok, both read
{ displayName: 'Ann', role: 'project manager' } (lowercase, the very spelling in the report). Starting both is also two
Claudes in one worker folder, the #362 harm.

This is the first reading of the old "weakest premise", but the folder is SHARED by a product path, not copied.

## Fix
- discover.folderTakenBy(dir, name): the other name whose profile records this folder (register.known() for the
  names; refuses when profiles cannot be read, like the roster check: adding blind is the failure).
- connect and registerOnly (the folder-only path) refuse with "that folder is already connected as <name>, and one
  folder holds one agent", BEFORE the profile write. The same name re-connecting its own folder is unchanged.
- alreadyIn (the found list) counts a folder recorded under any name as in, so the list never offers what connect
  refuses (#362: one definition).
- Only two writers record profile.dir (discover.js connect + registerOnly); both are covered.

## Not done, stated
- An install that ALREADY has two names on one folder keeps them (no migration). Their roles keep matching. Removing
  either is the person's call; a board warning for it would be its own card.
- Josh's #1531 ruling 2(a) lets a typed name win for a folder holding several agents' FILES; it never allowed two
  names on one folder, which reads one file.

## Validation (fix)
- engine/connect-onefolder-4896.test.js 5/5; against origin/main's discover.js 4 red, CONTROL green.
- engine/connect-agent.test.js and projects.member-roles-4896.test.js green alongside (17/17).

## Review 2 (23:06 CDT): 0 BLOCKER, 1 SHOULD-FIX, NITs
- SHOULD-FIX taken: a REMOVED agent's profile outlives the removal (remove.js does not clear dir), so its folder was
  refused under any new name, naming an agent that is gone. folderTakenBy now skips names remove.hidesCard says are
  gone (the board's own test). Test: connect, mark removed, the same folder connects under a new name and the found
  list offers it again. Red on the previous commit.
- NIT taken: paths compared via path.resolve, so /x/F/ and /x/F are one folder (tested).
- NIT checked: the refusal is rendered with textContent (web/index.html, the found list's Add), so the display name
  in it cannot inject markup.
- NIT accepted, stated: alreadyIn now reads every profile per candidate folder: O(folders x agents) small JSON reads,
  roughly 10,000 for 200 folders x 50 agents per scan. Fine at today's sizes; hoist into a per-scan map if a scan is
  ever measured slow.
- (RETRACTED by review 3: I wrote that writeProfile never writes a name failing NAME_RE. False: the folder-only path
  writes a one-letter typed name. See below.)
- NIT accepted: the unreadable-profiles arm self-skips when run as root (it cannot make the dir unreadable there).

## Review 3 (23:10 CDT): 1 BLOCKER, 4 SHOULD-FIX, all MEASURED by the reviewer in a sandbox, all taken
- BLOCKER: review 2's "gone" test was remove.hidesCard, which is ALSO true for a card cleared while its session was
  deliberately left running (leftRunningByChoice). That freed a RUNNING agent's folder: a new name connected and
  STARTED a second Claude in it. Now only a removal that actually stopped (stopped !== false, not leftRunningByChoice)
  frees the folder; a partial removal (stopped:false) keeps the claim too.
- Restore (remove.restoreInner) put two names back on one folder after a stopped removal's folder was taken. Now
  refused: "<Ann>'s folder is now connected as <Bob>, and one folder holds one agent. Remove <Bob> first to restore
  <Ann>." An unreadable profile list refuses too.
- The self-exclusion compared the raw name with the FILE key (safeKey lowercases, strips spaces), so "Casey Jones"
  refused its own folder on a retry, a regression against main. Now compared by store.profileFileName.
- register.known() filters by NAME_RE, so a one-letter typed name's claim was invisible. folderTakenBy now reads
  every *.json in the profiles folder directly.
- path.resolve missed a case variant (APFS) and a symlinked parent (/tmp). canonDir uses fs.realpathSync.native,
  falling back to path.resolve for a folder that is gone.
- NIT (alreadyIn returned before the check when the basename is not a usable name): the any-name check now runs first.
- Tests: 5 new arms, each asserting the one-folder REASON (not just ok:false, so no arm passes via another refusal);
  all 5 red on the previous commit, green now. connect-agent, remove.test.js, member-roles green alongside (106/106).
- NIT taken: the two "same name again" controls now require ok:true, not merely "not this refusal".
- Out of scope, stated (reasoned, not measured): profiles are per world, so a DIFFERENT world could connect the same
  folder. Worlds are separate boards; its own card if it is ever seen.

## Review 4 (23:13 CDT): 0 BLOCKER, 3 SHOULD-FIX (measured), all taken
- Restore told the person to "Remove <holder> first" when the holder was itself on the removed list (left running
  or stopped:false): a dead end. folderHolders now carries removed, and restore says "<holder>, who was removed but
  may still be running there ... Stop <holder> first".
- Restore's "unreadable refuses" was false: store.readProfile answers {} for missing AND unreadable, so a corrupt own
  profile or an unreadable profiles folder skipped the guard and restored. Its own profile is now read with the
  ENOENT / unreadable split; unreadable refuses.
- alreadyIn cost: measured by the reviewer at 8.5 ms a call (2.5 s for 300 candidates x 300 profiles). The held set is
  now built once and reused for 2 s (heldFolders), cleared at every folder-record write in discover.js (connect,
  registerOnly, the rollback, the undo). Connect and restore never use the memo; they read fresh. Re-measured: 300 x
  300 in 38 ms. A removal (remove.js) does not clear it; a list drawn within 2 s of one can still hide that folder,
  and connect then decides fresh.
- NIT taken: canonDir resolves the nearest EXISTING ancestor, so a recorded folder that is missing still matches
  through a symlinked parent.
- Tests: 3 new arms, red on the previous commit; 109/109 with connect-agent, remove.test.js and member-roles.

## Review 5 (23:17 CDT): 0 BLOCKER, 1 SHOULD-FIX (measured), 2 NITs
- SHOULD-FIX taken: an agent Kosmos CREATED records no folder (create.workerDir falls back to <workers>/<name>), so no
  profile names it, and connect gave its home to a second name (measured by the reviewer: same workerDir for both).
  createdHomeOf: a folder directly inside the workers root is the home of the agent of that name; any other name is
  refused with "that folder is <name>'s own folder in Kosmos, and one folder holds one agent". create.js now exports
  workersDir for this. The found list is deliberately NOT changed for these folders: a leftover worker folder is
  offered under its own name as before, and connect refuses any other name.
- NIT taken: a relative recorded dir holds nothing (create.usableRecordedDir rejects it too).
- NIT accepted and stated in the HELD_MEMO comment: removals and restores (remove.js) do not clear the 2 s memo;
  neither direction can record a second holder.
- Tests: 2 new arms incl. the CONTROL that the created agent's own name is not a second holder; red on the previous
  commit. 111/111 with connect-agent, remove.test.js and member-roles.

## Review 6 (23:20 CDT): 2 BLOCKER + 1 SHOULD-FIX, all in round 5's createdHomeOf, all measured, all taken
- BLOCKER: the home was compared to the asker by SPELLING, so Bobby was refused its own folder bobby (APFS folds case).
  Now compared by profile FILE key.
- BLOCKER: a name whose OWN profile records a folder in the workers root under a different folder name (a slug
  folder: icecreamkitty recorded by ice-cream-kitty) was refused it, and restore named an agent that does not exist.
  A name that already records the folder is now free before the home rule is asked.
- SHOULD-FIX: any folder in the workers root counted as somebody's home, so a leftover folder refused every name
  but its basename. Now a home only for an agent that EXISTS (a job, or a profile, under that name).
- Tests: 3 arms incl. a CONTROL that an existing agent still holds its home; red on the previous commit. 130/130 with
  connect-agent, remove.test.js and discover.test.js.

## Review 7 (23:24 CDT): 0 BLOCKER, 2 SHOULD-FIX, 3 NITs, all taken (findings 1-3 measured by the reviewer)
- SHOULD-FIX: createdHomeOf read "an agent of that name exists" as "this is its home", but an agent of that name
  connected ELSEWHERE does not live in <workers>/<name>; the list offered the folder and connect refused it with a
  false sentence. A home now counts only when canonDir(create.workerDir(name)) IS the folder.
- SHOULD-FIX: store.profileFileName throws for a name safeKey empties (a created agent named only with letters it
  strips); connect threw and the person saw a reason-less failure. Every key lookup goes through profileKey (no
  key, never a throw), and restore wraps folderTakenBy as "could not check".
- NIT: a job we could not check (create.jobPresence 'unknown') now refuses like every other unreadable case.
- NIT: a removed created agent keeps its home; the sentence says "(an agent you removed)".
- NIT: the helpers had landed between registerOnly and its doc comment. Moved below registerOnly; the duplicate top
  comment is now a plain section note.
- Tests: 3 arms, red on the previous commit (the odd-name arm reproduces the throw with a real job file).
- DECIDED, the reviewer's simpler design (one rule: a folder belongs to N when canonDir(create.workerDir(N)) is it,
  for every known N): NOT rewritten. After the round-7 fix the two arms already ARE that rule: a recorded dir is what
  workerDir resolves for that name, and the default home <workers>/<name> is reachable only by its own basename. The
  one behaviour difference: under the single rule a STOPPED removed created agent would free its home; here it keeps
  it and is named "(an agent you removed)", the safer side (restore never meets a conflict). A rewrite would discard
  22 tested arms for no visible change. Weakest premise: that no created agent resolves outside <workers>/<name>
  without a recorded dir; workerDir's code says it cannot. What would change my mind: a second fallback in workerDir.

## Review 8 (23:25 CDT): 0 BLOCKER, 2 SHOULD-FIX (small), 2 NITs, taken
- A null key matched a null key: an unkeyable created agent read as "removed" because a different unkeyable name
  was. removed now needs a key. Test red on the previous commit.
- folderHolders' comment said a stopped removal frees "its folder"; it frees its RECORDED folder, while a created
  agent's default home stays held (createdHomeOf). Comment corrected.
- NITs: alreadyIn's two stacked comments merged, the stray blank line removed. The HELD_MEMO note still holds.

## Review 9 (23:41 CDT), end to end through the real server routes: 2 SHOULD-FIX (both restore copy), 1 NIT
- Measured: 154 test files that require discover/remove/create, each alone: 154 exit 0, 2916 pass, 0 fail.
- SHOULD-FIX taken: the restore refusal named the holder by its display name, which is usually the restored agent's
  own (the second name reads the same file): "Remove Carl first to restore Carl." The holder is now named by its own
  agent name when its display name matches. My r3 and r4 tests had PINNED the bad sentence ("connected as Kit",
  "Stop Mo first"); corrected to the agent names. New test: the reviewer's exact carl/dan sequence.
- SHOULD-FIX, routed: the page drops every restore refusal's reason ("Restore failed. Try again."), older than this
  branch. Filed as kosmos#4976 (claimed), not built here: a web change brings its own browser-check gate, and this
  card is engine-only.
- NIT taken: the created-home sentence names the agent as the board shows it (Eve, not eve).
- Not taken: discover.js sentences use the curly apostrophe like their siblings in that file; remove.js uses straight
  ones like its own siblings. Each matches its file.

## Review 10 (23:42 CDT): 0 BLOCKER, 0 SHOULD-FIX = CONVERGED
- It answered round 9's open questions: a safeKey'd name reaches the person only in the same-display-name restore
  case ("Remove caseyjones first to restore Casey Jones": true and actionable); readIdentity is guarded and runs only
  on the refusal path.
- NIT taken: HELD_MEMO keyed by store.PROFILES, so two stores in one process never share it.
- NIT not taken: connect's sentence says "already connected as Carl" to a person who typed carl-2, when both read one
  file. True, and it names who has the folder; restore needed the swap because there the sentence named the person's
  own agent back to them.
- Focused: 138/138 (connect-onefolder, remove, connect-agent, discover, member-roles). Round 9 ran all 154 files that
  require discover/remove/create: 2916 pass, 0 fail. Full suite next, on Mortals.
