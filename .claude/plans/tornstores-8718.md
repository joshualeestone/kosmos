# tornstores-8718: crash-safe stores (kosmos#8718)

## Goal
A store a crash left empty or all zero bytes must not hold a feature off SILENTLY. A new raw in-place store write must not slip in unseen.

## Decided (revised at review round 5)
- A start-up check (engine/tornstores.js `check`, called from server.js in onListening, after the bind, only when server.js is the board) scans the data root for torn stores: `.json` empty or all zero bytes, `.jsonl` all zero bytes. It REPORTS each one, a board.log line and a record at `tornstores/last-check.json` (removed when nothing is torn), and changes NO store.
- Not looked at: damaged-but-real content, files changed in the last 5 s, non-regular files by lstat (symlinks), files over 8 MiB, deeper than 3 folders, top-level attachments/downloads/filepreview/worlds/bin/runtime and its own folder.
- A ratchet test (engine/rawwrites-8718.test.js) on the per-file count of `writeFileSync(` outside comments in server.js and engine/*.js: exact match to a baseline (135 in 79 files on 11-18). It converts no write; the atomic-write half of the card is #5434's work plus this guard against regrowth.

## Why report-only (the reversal)
The first design MOVED torn stores aside so readers take the absent default. Round 5 measured that this overrides deliberate fail-closed rules: phone-notify-choice.json (its existence IS the person's off, #6488; moved, phone notices went off -> unset, which default-on turns on), autobalance.json (unreadable reads off), remote.json (#4308: unreadable stays visible until the person repairs it); heartbeat.json says the same (Josh 2026-09-03). "Unreadable reads off" is a rule, so only the store's owner or the person can decide a reset. The check makes the torn state visible instead.

## Rejected
- Moving or resetting torn stores automatically (above).
- An allowlist of resettable stores now: no store was found where unreadable differs from absent AND absent is safe (liveness, activity, disruption read both as found:false already). An owner can add one later with its reader's case.
- Editing each of ~273 readers.
- A board UI notice in this PR: lastCheck() and the record exist for it; the notice, with a person-pressed reset per file, is the follow-up card.

## Weakest premise
That the log line and record are enough until the board notice lands: a person does not read board.log. The follow-up is what makes it visible to them.

## Tests
- engine/tornstores-8718.test.js: shapes found, every byte of every store unchanged (snapshot), record, stale record removed, missing root, symlinks (POSIX), a zeroed phone-notice choice still reads off after the check, wiring inside onListening, SIGKILL mid saveFlushed leaves a whole file.
- Mutations red: move-instead-of-report, no stale removal, no worlds skip, no lstat isFile, depth 2, call outside onListening; ratchet red on a real raw write, green on a comment.
- tools/windows-tests.js ALSO lists the test.
## Review round 1 (opus): fixed
- BLOCKER worlds/ walked on the default world: added to SKIP_DIRS, MAX_DEPTH 6 -> 3 (measured real depth), test arms for worlds/ projects and data root.
- WARNING a second launch scanned before losing the bind: moved into onListening.
- WARNING census counted comments: comments stripped, rebaselined, control for comments.
- WARNING kill test could pass with no save: asserts at least one round saved, longer timeouts.
- NITs: dead symlink line removed (dirent never isFile for a link), symlinked file and folder arms, MAX_ENTRIES counts every entry and the walk stops at the cap, token wording now names only what the path says.
- Known limit: a module that read a torn store BEFORE the bind keeps that reading until it reads again; most read per call.

## Review round 2 (sonnet)
- WARNING scan-to-move gap: fixed, each file is looked at again just before its move; test hands in a stale scan.
- WARNING any future empty .json marker under the root would be moved: DEFERRED. Grepped engine and server.js: no code writes an empty .json or .jsonl today (the empty markers are .reauth-seeded, ct-watch-off, an -ack file). An empty .json already fails JSON.parse for any reader, so the only behaviour change is for an existsSync marker, and the module header names the two shapes so a future author can see it.
- NIT failed-line wording matched to the moved-line wording.

## Review round 3 (opus)
- WARNING symlink arms would throw EPERM on a Windows runner and sink the shapes test: moved to their own test, skipped on win32 with the reason; windows-tests.js comment says so.
- WARNING server.js comment overclaimed (a different-port double start still scans): cut to the guarded claim, a launch that loses the port never scans.
- NITs taken: ENOENT from another run's move is not reported as "left where it is"; a scan answer naming a path outside the root moves nothing (test); the symlink arm now points at a zero-filled target with an OLD link mtime, so it fails when lstat's isFile check is removed (it passed vacuously before: the link was new and its target empty); the duplicate dirent isFile check removed.
- NITs left: RECENT_MS vs Linux RestartSec=5 (node boot covers it; a skipped file is looked at next start), torn/ never pruned (each folder is evidence; small), 64 KiB first read (files are small; measured about 2,100 files).

## Review round 4 (sonnet)
- WARNING depth limit had no positive control at the edge: a torn a/b/c/x.json now must be moved; MAX_DEPTH 2 turns it red.
- WARNING lstat-to-rename gap: DEFERRED, milliseconds wide behind the 5 s recency rule and the re-check; a post-move check could only race again.
- WARNING containment filter detail (drive-root data root fails closed; only injected test answers reach it): DEFERRED, informational, fails safe.

## Review round 5 (opus, code only)
- BLOCKER moving a torn store reverses deliberate fail-closed rulings (measured: phone choice, autobalance, remote): FIXED by the report-only redesign above.
- WARNING the atomic-write half is not converted here: stated in Decided and in the PR body.
- NIT wiring test now bounded by the end of onListening. NIT codeOnly claim: the ratchet header says "crude"; the round-1 comment sentence about hiding writes stays limited to comment rewording.
- Rounds 2-4's move-related fixes (re-check before move, ENOENT, path containment) went with the move code.
