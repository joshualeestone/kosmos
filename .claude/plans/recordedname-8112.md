# kosmos#8112: a case variant of a profile-recorded agent's name is not its exact name

## The defect (from the card, confirmed on main by test)
A connected agent's folder is recorded in its profile, keyed on store.safeKey (lowercased). So
create.workerDir('Kcrec8112') returns kcrec8112's recorded folder and existsExactly on it is true:
- plan('Kcrec8112') answered ok under a name with no job and no session; remove then wrote a removed record for it
  and said "removed" while the real agent ran on (a false success);
- resolve('Kres8112', listed [kres8112]) counted the variant as an exact agent too, so the CLI was refused with
  "more than one agent is called Kres8112 (Kres8112; kres8112)", naming a phantom.
Both reproduced on origin/main by the two new tests before the fix.

## The call
remove.folderIsExactly(clean): a folder recorded in the profile never proves the spelling (Sonya Blade's point on the
card: the profile carries none). exists() and resolve() use it; the exact name must then come from the job, the
session, or a listed card with exactly that name. An agent whose folder is not recorded is named by its folder, as
before. create.agentDirRecorded is exported for this.

## Rejected
- Storing the exact spelling in the profile: a migration for every existing agent, for a check the job and session
  already answer.
- Folding into #8109's branch: it merged without the pin.

## Weakest premise
A profile-recorded agent with no job, no session and no card can no longer be found by name (plan says "cannot
find"). That is the refusing direction, which the card allows; such an agent has nothing running to stop.

## Verification
engine/remove.test.js: two #8112 tests (plan refuses the variant and still plans the exact name; resolve answers the
one listed agent, no phantom), both failing on main and passing after. 129 files touching remove or workerDir:
2871 tests, 0 fail.
