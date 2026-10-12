# backuptick-5535: what a company backup covers, and the hourly tick (kosmos#5535 E0.6 slice (d))

Stacked on runbackup-5535 (itself on four unmerged prerequisites). Rebuilt from main when they land.

## What
engine/backuptick.js: rootsFor (the roots), startTick (the timer and its pauses), inputsHere (the real sources),
startHere (the board's tick). server.js start(): startHere, beside the hourly file-preview sweep.

## Decisions
- Covered: the workers root (REQUIRED), the projects root, projects outside both (elsewhere/<id>), agent folders outside
  the workers root (agents/<id>), each agent's transcripts (backupsessions). Everything but workers is optional.
- NOT covered: the data root. It holds the keys, the backup state, pairing and codex-homes: credentials the card says
  never to take, and Kosmos's own state rather than the person's work.
- Known gap, stated in the header and filed as kosmos#5883 (review 5 widened it): transcripts of agents on named Codex
  or Gemini accounts, per-session Codex homes, and every Grok agent. Their folders are backed up; their transcripts are not.
- Gate: orgenroll.mayReport() (enrolled here AND the company's words accepted here), the gate orgenroll names for
  every sender, E0.6 included. CORRECTED in review 7: this first said isEnrolledHere. First run an hour after start, never at boot.
  Residual: asked when a run starts; a Leave during a run does not stop that run (a rollup re-asks per batch).
- backup_off pauses a day (Kosmos+ answers 404 backup_off on backup-key while backup is off, coordinator plan
  orgescrow-5535). overAllowance pauses to the next Monday 00:00 UTC. A tick during a run is skipped.
- A reason a person acts on (refusedState, missing, unreadableKeyFile) is said once, on the board's log, until it
  changes or a run succeeds. A screen for it is later work.
- engine.reachable: 18 run-path excuses removed (their caller, the tick, is wired from server.js now). 10 kept: the
  restore side (restoreSnapshot, openManifest, openVerifiedChunk: restore is NOT wired; the excuse is that record) and
  7 unused key and format helpers. CORRECTED in review 1: this first said "21 made reachable by this wiring". Measured
  (orphan list printed as JSON, not node's array): the guard's "reachable" is a NAME match in any non-test file, so most
  run-path names already read reachable on runbackup-5535 just because backuprun.js names them, and runBackup itself
  only because my own re-decision comment in test-connector-verbs.sh mentions it. A mention, not a call.

## Rejected
- Backing up the data root with excludes: every exclude is a place a credential can be missed, for content the card
  does not ask for.
- Running at boot: every board restart would send a request; an hour later is at most one an hour.

## Weakest premise
That a refusal that names no pair is the right signal to back off on. It covers an unreachable Kosmos+ and an older
connector (no refusal code, review 1), but also any new pre-company refusal; if one of those should NOT wait (a
transient that clears in minutes), the first retry is still an hour away, the doubling only starts after that.

## Tests
engine/backuptick.test.js (7) and engine/backuptick-inputs.test.js (2). Guards by hand: #1732 8/8, connector verbs
27/27, engine.reachable 7/7, every backup test together 417/417.

## Mutants
Measured 19:46 CDT from `date`, all red: T1 workers optional, T2 no already-covered check, T3 a bad project slug added, T4 runs while not enrolled, T5 no backup_off pause, T6 said every tick, T7 no skip while running, T8 nextWeekStart on a Monday gives the same instant, T9 a hidden folder counted as an agent, T10 a success does not reset what was said.

## Review 1 (opus, blind, on 96ecd6d5): two must-fix, three nits, all taken
1. MUST-FIX: nesting was checked one way only; backupsnapshot drops BOTH optional roots of a nested pair, so an agent
   folder holding a project lost both, and one at ~/Kosmos lost every project. FIXED: an outer root replaces the inner
   ones it holds; one that would hold workers is refused. Test asserts no two roots nest by real path.
2. MUST-FIX: "never the data root" was a sentence, not a check; a project or agent folder holding the data root or a
   provider home would sweep it whole. FIXED: `protect` (data root + each config home), a root holding or inside one is
   refused. Tests for both directions and for workers itself inside protected data.
3. NIT: `left` was thrown away, and no workers root still sent a backup-key request hourly. FIXED: left said once per
   change; no workers root, no run and no request.
4. NIT: an older connector gives no refusal code, so backup_off would never pause. FIXED generally: any refusal before
   Kosmos+ named the company backs off 1, 2, 4 ... 24 hours. Test of the schedule and of its reset.
5. NIT: the excuse claim was wrong. FIXED and measured, see Decisions.
Tests 9 -> 13 (+4), inputs test asserts protect.
Mutants after review 1 (19:53 CDT from `date`), each tests 13 pass 12 fail 1: Y1 no outer replace, Y2 a root may hold workers, Y3 no protection, Y4 protection one way only, Y5 a run with no workers root, Y6 left said every tick, Y7 no backoff when no pair, Y8 the backoff never resets, Y9 inputsHere passes no protect.

## Review 2 (sonnet, blind, on 5fd1c526): no must-fix, eight nits; seven fixed, one accepted
1. FIXED: transcript roots were never checked against folder roots (a linked provider folder can sit inside or hold
   one, and the snapshot drops both). A last pass: inside one, dropped (covered); holding one, left and said.
2. FIXED: names passing SEGMENT but refused by the snapshot (secrets, aux) were dropped silently; now checked with
   the snapshot's own rootNameProblem and said.
3. FIXED: a protected entry that is not a full path now fails CLOSED (no roots, said).
4. FIXED: a roots() that throws is said once, with no run.
5. FIXED: overAllowance is said once; a missing because never prints "undefined".
6. ACCEPTED, no change: a runBackup that never settles keeps every later tick skipped. A tick-level timeout cannot
   recover it: runBackup chains its runs, so a new one would queue behind the hung one anyway. The fix belongs in the
   request layer's timeouts (remote.macRequest, the uploaders' fetch). What would change my mind: a hang measured there.
7. FIXED: the inputs test now asserts the Codex home is protected too.
8. FIXED: config roots sorted by full path, not basename (ties would swap the -<n> names).
Tests 13 -> 16 (+3).
Mutants after review 2 (19:56 CDT from `date`): Z1 no transcript pass, Z2 no snapshot name rule, Z3 relative protect fails open, Z4 a throwing roots() silent, Z5 overAllowance silent, Z6 because printed raw: all red (15/1). Z7 basename sort: SURVIVES, NOT equivalent. Untested: configRoots reads the real ~/.claude* unless AGENT_WORKFORCE_CONFIG_ROOT pins ONE root, so no sandbox here has two to order, and a test-only sort export would trip engine.reachable. A known uncovered line, said here.

## Review 3 (opus, blind, on f4dcb3bf): one must-fix, two nits
1. MUST-FIX, FIXED: protection and nesting compared paths as spelled. plain realpathSync keeps the case it is given
   (measured: /users/agent1/LIBRARY stays so; .native gives /Users/agent1/Library), and macOS volumes are
   case-insensitive, so a project at /users/me/library would hold the data root unguarded. Now every comparison is
   between native (true) spellings; transcript roots keep backupsessions' path (the snapshot requires it equal its plain
   realpath) and are compared by their native form. Test with a control; red on the old code on this Mac.
2. NIT, MEASURED, not changed: hpkeSeal's excuse is stale, but it is engine/hpke.js's, predates this branch, and was
   never in my "7" (those are all backup*.js). createChunker's IS needed: printed orphan list with both removed shows it.
3. NIT, FIXED: the header now names overAllowance among the reasons said once.
Mutant after review 3 (20:00 CDT from `date`): C1 back to plain realpath: red (tests 17 pass 16 fail 1).

## Review 4 (sonnet, blind, on ecd6d8be): no must-fix; two nits, both fixed
It traced the native spellings through listRoots, the walk, readListed and restore: nothing downstream compares them
against a plain realpath (the only equality check is for `only` roots, which keep their path).
1. FIXED: a runBackup that throws (it never should) is said once, not swallowed every hour.
2. FIXED: transcripts are looked up by the agent folder as Kosmos recorded it, not its true spelling, since a
   transcript records the folder its agent started in. Tests 17 -> 18.
Mutants after review 4 (20:01 CDT from `date`): D1 a thrown run silent: red. D2 transcripts by the native folder: first SURVIVED, because my test's second spelling (path.join with '.') was normalised to the same string, so the test was vacuous. Rewritten with a symlink and a control that the spellings differ; D2 now red (16/15/1 in that file).

## Review 5 (opus, blind, on 74883306): two must-fix, both taken
1. FIXED: protect covered the default provider homes only; named accounts (~/.codex-<label>, ~/.gemini-<label>) and all
   of Grok were missing, so for a Codex- or Grok-only person a root holding home would be walked with only file-name
   rules in front of their sign-ins. Now every account folder the three account modules list, Grok's default home, and
   every hidden entry directly in the home folder are protected. The last makes any root holding home refused whatever
   lives there; the lists are best effort, the home rule is not. Test in a sandboxed home with a control.
2. FIXED (scope, stated): the transcript gap was understated. Header and plan now name all four cases; filed #5883.
Mutants after review 5 (20:04 CDT from `date`): H1 no hidden-home rule: red. H3 no Grok default home: first SURVIVED (the test unset AGENT_WORKFORCE_GROK_HOME, so the hidden rule covered ~/.grok); a test with the Grok home set OUTSIDE home added, now red. H2 the three account lists dropped: SURVIVES and is equivalent today: every folder they list is in the home folder (hidden rule) or is a default home protected on its own line.

## Review 6 (sonnet, blind, on f920e0d2): no must-fix; two nits, both fixed
It checked the defaults: workers (~/work/workers), projects (~/Kosmos/Projects) and the Mac data root are not hidden,
so the hidden-folder rule refuses none of them.
1. FIXED: hidden entries of BOTH homes when AGENT_WORKFORCE_HOME differs from the real home (projectsRoot uses the
   real one). Test.
2. FIXED: the refusal now says "or a hidden folder in the home folder", true for a folder that is merely hidden.
Tests 20 -> 21.
Mutant after review 6 (20:06 CDT from `date`): K1 one home only: red (21/20/1).

## Review 7 (opus, blind, on ba08ce63): one must-fix, one nit, both fixed
1. MUST-FIX: the gate was isEnrolledHere. orgenroll's own comment names mayReport as the gate for EVERY sender, E0.6
   backup by name: a record re-adopted after an unwritten move, or rebuilt after a last-admin refusal, is enrolled with
   no consent, and the tick would have uploaded the person's work under it. Nothing downstream asks mayReport. FIXED:
   mayBackUp() = mayReport(); test with a control that the consent-less record reads as enrolled here. Residual stated.
2. NIT: `said` reset only on success, so a reason that came back after other failures was never said again. FIXED.
Tests 21 -> 23.
Mutants after review 7 (20:09 CDT from `date`): G1 gate back to isEnrolledHere: red. G2 said reset on success only: red (23/22/1 each).

## Review 8 (sonnet, blind, on 99807647): no must-fix; it found no send without mayReport. Five nits:
1. FIXED: inside() read a child named "..x" as outside its parent (startsWith('..')), so ~/.ssh/..x escaped protection.
2. FIXED: protection that could not be checked was dropped silently (a protected folder that exists but does not
   resolve, a home folder that cannot be listed). Now fails CLOSED, said; a protected folder that does not exist still
   protects nothing (control).
3. ACCEPTED: overAllowance's sentence carries Kosmos+'s own refusal text to the board log. It holds no path or name
   from this computer.
4. FIXED (header): transcript roots sit inside a protected provider home by design and skip the protection check;
   their safety is backupsessions' session-file lists. Said in the header.
Tests 23 -> 24.
Mutants after review 8 (20:11 CDT from `date`), each 24/23/1: E1 '..' prefix match back, E2 an unresolvable protected folder dropped (proves the locked parent gives a non-ENOENT error here), E3 protectIncomplete ignored.

## Review 9 (opus, blind, on 776b782e): one must-fix, one nit
1. MUST-FIX, FIXED: names were refused when the root-name rule could not carry them, but Kosmos's own names allow `_`
   (create.js NAME_RE) and project ids run to 64 characters (projects.idFor). So `ice_cream` lost its transcripts, and a
   `q3_plan` project outside the projects root lost its folder, said only as a nameless log line. My review-1 test locked
   that in as correct. Now every id maps to a root segment: kept as is when it is a good segment the snapshot accepts,
   else its cleaned form plus 8 hex of its SHA-256 (stable across snapshots; a_b and a-b never share one). Transcripts
   are asked for under the same segment. Tests rewritten to the mapped behaviour, with a control for a good id.
2. NIT, FIXED BUT UNTESTED HERE: on Windows, %USERPROFILE%\AppData (browser password stores, Credential Manager) is
   protected whole. The line runs only on win32; this Mac cannot run it, and it is said here rather than implied.
Mutants after review 9 (20:14 CDT from `date`): M1 no hash (a_b and a-b collide): red. M2 refuse non-segments again: red. M3 transcripts under the raw id: red. M4 no snapshot check on a kept id (secrets kept as is): red.
