# casedelete-5003: a delete asked in another case must not touch a running agent (kosmos#5003)

## Problem
delete-leftover plan() checked "is it running?" with `sessionName === clean`, but on a Mac (and Windows) workerDir and
plistPath are case-blind, so plan('miles') found Miles's folder and job while Miles ran, found no live session named
'miles', and del() moved the RUNNING agent's folder and auto-start file. Found by #5000's review round 2.

## Change
plan(): on darwin and win32 the running check compares case-blind (as create.js already does for launch paths). The
refusal names the running agent as it is (Miles), not as asked.

## Rejected
- Reading the folder's real case (realpathSync.native) and checking that name: misses a job-only leftover (plist).
- Lowercasing every name in cleanName: changes how every agent is named and stored.

## Weakest premise
Mac and Windows disks are assumed case-blind. A case-sensitive APFS volume makes this refuse a delete that would have
been fine ("X is running"); that is the safe side, and such a volume is rare for a home folder.

## Tests
delete-leftover.test.js +1: asked as miles5003 / MILES5003 while Miles5003 runs, plan refuses and del leaves the folder and
the plist; control: own case also refused, and a stopped leftover is offered. Sabotage (caseBlind = false): red.
Sibling files green: web.delete-leftover 7/7, jobexists.win32-570 14/14.

## Review 1 (blind): 0 blockers, 1 warning, 1 nit; both taken
- W (on main) a STOPPED leftover asked as 'miles' for Miles: files found case-blind, but launchctl bootout used label
  ...miles (launchd is case-sensitive, so Miles's job stayed loaded with its plist in the Trash) and remove.forget('miles')
  missed Miles's removed record (a new Miles came up hidden). -> realCaseName(): plan() takes the agent's own spelling
  from the folder's real name (realpathSync.native) or, for a job-only Mac leftover, from the plist's real name
  (parseServiceLabel); only when the two differ in case alone; never through a link. Every later step uses it.
  Tests +2 (stopped folder+job: plan name, bootout label, removed record; job-only: name and label). Sabotages red:
  realCaseName returns asked (2 fail); no plist branch (1 fail).
- N the case-blind refusal did not say the names were taken as one -> "(this computer does not tell X and Y apart)".
- Note, measured: with realCaseName in place the case-blind running check is a SECOND line (it fires only when the
  disk read fails, which falls back to the asked name); its sabotage alone is no longer red. Kept on purpose.

## Review 2 (blind, whole diff): 0 blockers, 1 warning, 3 nits; all taken
- W realCaseName read the name of create.workerDir(asked), which is a connected agent's RECORDED folder first (anywhere,
  any name); inside the workers folder (workers/team/Miles) it would rename `miles` to `Miles` and del() would stop the
  wrong label and miss miles's own records -> the folder counts only when its real parent IS the workers folder.
  Test +1 (recorded workers/team/Cato5003 for cato5003: name stays as asked; control: workerDir answers the recorded
  folder). Sabotage (no parent check): red.
- N the new function sat under plan()'s doc comment -> moved above it.
- N "(this computer does not tell X and Y apart)" is false on a case-sensitive volume -> "(Kosmos treats X and Y as the
  same name here)".
- N "a link is never followed" overstated -> "A linked folder is not read here (plan() refuses it)".

## Review 3 (blind, whole diff): 0 blockers, 2 warnings, 2 nits
- W a connected agent `miles` recorded at workers/Miles (directly in the workers folder) was renamed to Miles -> the
  folder's spelling is read only when NO folder is recorded for the agent; and on the Mac the auto-start file's spelling
  is read FIRST and wins (it is the launchd label bootout must name). The review-2 parent check became unreachable
  (workerDir answers a recorded folder or WORKERS_DIR/<name>; its sabotage stayed green), so it is removed.
  Tests +2 (recorded workers/Nero5003 keeps nero5003; folder Vela5003 vs job vela5003 -> vela5003 wins).
- W Windows leftover with ONLY its startup task: NOT fixed, recorded as a KNOWN GAP in the code and here. Task
  Scheduler is case-blind so the task is removed, but the board's other records keep the asked spelling. Fixing means
  parsing schtasks /FO LIST output, which cannot be tested against a real Windows answer from this Mac.
- N win32 folder arm untested -> test +1 (stubbed schtasks "no such task"; ida5003 plans as Ida5003).
- N the running test no longer exercises the case-blind running check alone: documented since review 1.
Sabotages, each red: no recorded check (1); plist branch off (2); folder branch returns asked (1).
