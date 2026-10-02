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
