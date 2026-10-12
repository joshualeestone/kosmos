---
pre_challenge: true
method: challenge-loop
branch: backuptick-5535
diff_hash: 9bd151569f90ff44d31e61075492199815f72add14b6f2f9b1b928a6d05ff8a0
validation: passed (Mortals: 19459 tests, 19216 pass, 0 fail, 0 cancelled, hash 9bd151569f90)
subdir_audit: passed
timestamp: 2026-10-12T12:00:41Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 blind reviews: Opus, Sonnet, Opus, Sonnet, Opus, Sonnet, Opus, Sonnet, Opus, Sonnet.
**Converged:** Yes, at iteration 10 (Sonnet): NO NEW ISSUES. Converged at 10. Rebased onto main after runbackup merged (#5901): the branch's own 21 commits moved with git rebase --onto origin/main e8d3e6e5e; its six files are byte-identical to the converged pre-rebase tip (control: 949 diff lines against main on the same files); old tip kept as tag archive/backuptick-5535-prerebase.
**Findings:** every review's findings and dispositions are below, from the plan's Review sections.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (blind, on 96ecd6d5; two must-fix, three nits, all taken)
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

#### Iteration 2
**Reviewer model:** sonnet (blind, on 5fd1c526; no must-fix, eight nits; seven fixed, one accepted)
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

#### Iteration 3
**Reviewer model:** opus (blind, on f4dcb3bf; one must-fix, two nits)
1. MUST-FIX, FIXED: protection and nesting compared paths as spelled. plain realpathSync keeps the case it is given
   (measured: /users/agent1/LIBRARY stays so; .native gives /Users/agent1/Library), and macOS volumes are
   case-insensitive, so a project at /users/me/library would hold the data root unguarded. Now every comparison is
   between native (true) spellings; transcript roots keep backupsessions' path (the snapshot requires it equal its plain
   realpath) and are compared by their native form. Test with a control; red on the old code on this Mac.
2. NIT, MEASURED, not changed: hpkeSeal's excuse is stale, but it is engine/hpke.js's, predates this branch, and was
   never in my "7" (those are all backup*.js). createChunker's IS needed: printed orphan list with both removed shows it.
3. NIT, FIXED: the header now names overAllowance among the reasons said once.
Mutant after review 3 (20:00 CDT from `date`): C1 back to plain realpath: red (tests 17 pass 16 fail 1).

#### Iteration 4
**Reviewer model:** sonnet (blind, on ecd6d8be; no must-fix; two nits, both fixed)
It traced the native spellings through listRoots, the walk, readListed and restore: nothing downstream compares them
against a plain realpath (the only equality check is for `only` roots, which keep their path).
1. FIXED: a runBackup that throws (it never should) is said once, not swallowed every hour.
2. FIXED: transcripts are looked up by the agent folder as Kosmos recorded it, not its true spelling, since a
   transcript records the folder its agent started in. Tests 17 -> 18.
Mutants after review 4 (20:01 CDT from `date`): D1 a thrown run silent: red. D2 transcripts by the native folder: first SURVIVED, because my test's second spelling (path.join with '.') was normalised to the same string, so the test was vacuous. Rewritten with a symlink and a control that the spellings differ; D2 now red (16/15/1 in that file).

#### Iteration 5
**Reviewer model:** opus (blind, on 74883306; two must-fix, both taken)
1. FIXED: protect covered the default provider homes only; named accounts (~/.codex-<label>, ~/.gemini-<label>) and all
   of Grok were missing, so for a Codex- or Grok-only person a root holding home would be walked with only file-name
   rules in front of their sign-ins. Now every account folder the three account modules list, Grok's default home, and
   every hidden entry directly in the home folder are protected. The last makes any root holding home refused whatever
   lives there; the lists are best effort, the home rule is not. Test in a sandboxed home with a control.
2. FIXED (scope, stated): the transcript gap was understated. Header and plan now name all four cases; filed #5883.
Mutants after review 5 (20:04 CDT from `date`): H1 no hidden-home rule: red. H3 no Grok default home: first SURVIVED (the test unset AGENT_WORKFORCE_GROK_HOME, so the hidden rule covered ~/.grok); a test with the Grok home set OUTSIDE home added, now red. H2 the three account lists dropped: SURVIVES and is equivalent today: every folder they list is in the home folder (hidden rule) or is a default home protected on its own line.

#### Iteration 6
**Reviewer model:** sonnet (blind, on f920e0d2; no must-fix; two nits, both fixed)
It checked the defaults: workers (~/work/workers), projects (~/Kosmos/Projects) and the Mac data root are not hidden,
so the hidden-folder rule refuses none of them.
1. FIXED: hidden entries of BOTH homes when AGENT_WORKFORCE_HOME differs from the real home (projectsRoot uses the
   real one). Test.
2. FIXED: the refusal now says "or a hidden folder in the home folder", true for a folder that is merely hidden.
Tests 20 -> 21.
Mutant after review 6 (20:06 CDT from `date`): K1 one home only: red (21/20/1).

#### Iteration 7
**Reviewer model:** opus (blind, on ba08ce63; one must-fix, one nit, both fixed)
1. MUST-FIX: the gate was isEnrolledHere. orgenroll's own comment names mayReport as the gate for EVERY sender, E0.6
   backup by name: a record re-adopted after an unwritten move, or rebuilt after a last-admin refusal, is enrolled with
   no consent, and the tick would have uploaded the person's work under it. Nothing downstream asks mayReport. FIXED:
   mayBackUp() = mayReport(); test with a control that the consent-less record reads as enrolled here. Residual stated.
2. NIT: `said` reset only on success, so a reason that came back after other failures was never said again. FIXED.
Tests 21 -> 23.
Mutants after review 7 (20:09 CDT from `date`): G1 gate back to isEnrolledHere: red. G2 said reset on success only: red (23/22/1 each).

#### Iteration 8
**Reviewer model:** sonnet (blind, on 99807647; no must-fix; it found no send without mayReport. Five nits:)
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

#### Iteration 9
**Reviewer model:** opus (blind, on 776b782e; one must-fix, one nit)
1. MUST-FIX, FIXED: names were refused when the root-name rule could not carry them, but Kosmos's own names allow `_`
   (create.js NAME_RE) and project ids run to 64 characters (projects.idFor). So `ice_cream` lost its transcripts, and a
   `q3_plan` project outside the projects root lost its folder, said only as a nameless log line. My review-1 test locked
   that in as correct. Now every id maps to a root segment: kept as is when it is a good segment the snapshot accepts,
   else its cleaned form plus 8 hex of its SHA-256 (stable across snapshots; a_b and a-b never share one). Transcripts
   are asked for under the same segment. Tests rewritten to the mapped behaviour, with a control for a good id.
2. NIT, FIXED BUT UNTESTED HERE: on Windows, %USERPROFILE%\AppData (browser password stores, Credential Manager) is
   protected whole. The line runs only on win32; this Mac cannot run it, and it is said here rather than implied.
Mutants after review 9 (20:14 CDT from `date`): M1 no hash (a_b and a-b collide): red. M2 refuse non-segments again: red. M3 transcripts under the raw id: red. M4 no snapshot check on a kept id (secrets kept as is): red.

#### Iteration 10
**Reviewer model:** sonnet (blind, on 61a1828b; NO NEW ISSUES. Converged at 10.)
It replicated rootSegment over about 35 ids (reserved, secret-looking, unicode, underscores) under every prefix; all
pass the snapshot's rule. Noted, not material: a kept id literally equal to another id's mapped form (a-b-648fa9b3
beside a_b) would share a name; it needs a constructed id or a 32-bit hash match, and the duplicate is an optional
root the snapshot records as skipped, never a failed backup.
