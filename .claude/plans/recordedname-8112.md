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

## Weakest premise (revised after review 1)
Round 1's BLOCKER: the first version made a register-only agent (discover.registerOnly: recorded folder, no job,
nothing started, card on the board) unremovable by its own name; "nothing running" missed that removing also takes
the card off. Revised rule: a recorded folder proves a spelling when the profile's displayName is exactly it
(registerOnly writes the typed name) AND no job is under the lowercase machine name (an adopted `cai` shown as "Cai"
has its job under cai). The reviewer's "the key form proves it" was not taken: registerOnly accepts any name
nameUsable allows, uppercase included (measured), so an uppercase register-only name would have become unremovable.
Remaining premise: an adopted agent with no job whose displayName is a case variant of its machine name would let
that variant plan; adoption writes a job (#1347, #3519), so this needs a job removed by hand.
Correction (review 2): a register-only agent has no card unless it is started by hand (createdroster lists agents
with a job; panelessKeys needs a live heartbeat). Round 1's fix still matters: the CLI and the API remove by name.

## Verification
engine/remove.test.js: two #8112 tests (plan refuses the variant and still plans the exact name; resolve answers the
one listed agent, no phantom), both failing on main and passing after. 129 files touching remove or workerDir:
2871 tests, 0 fail.

## Review 1 (applied)
- BLOCKER register-only unremovable --> FIXED (displayName rule above; tests: exact plans, variant refused, uppercase name)
- WARNING the fixture always had a job --> FIXED (register-only fixture with no job, its CONTROL asserts no plist)
- WARNING forgetCodexFolder ran on the variant --> FIXED (skipped when the recorded folder is another spelling's)
- NIT the removed message read workerDir --> FIXED (folderIsExactly)
Mutants: no displayName check (2 fail), no job check (1 fail), recorded never proves (2 fail). 129 files, 2874 tests, 0 fail.

## Review 2 (applied)
- WARNING Windows: schtasks task names ignore case, so jobFor('Cai') finds cai's task and exists() passes before
  folderIsExactly. NOT fixed here: it predates this change, affects every agent on Windows (not only recorded ones),
  and cannot be tested on this Mac. Filed as #8177 (unclaimed).
- WARNING a rename rewrote displayName and stranded a register-only agent --> FIXED: connect writes connectedAs (the
  spelling a rename never touches), compared first; an older profile falls back to displayName (the stated limit).
  Tests: renamed agent still plans; older profile plans; mutant "connectedAs ignored" fails 1.
- NIT the Codex trust skip has no test --> KEPT UNPINNED, measured: the step runs only when create.readJob(clean)
  finds a codex job under that exact spelling, and readJob refuses names outside NAME_RE, so an uppercase variant
  never reaches it. The reachable case (a lowercase variant of an uppercase register-only agent, with its own codex
  job) needs a real codex job fixture. A test written for it passed with the guard deleted, so it was removed rather
  than left as false coverage.
- NIT the plan's card premise --> CORRECTED above.
