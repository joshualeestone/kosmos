# tornstores-8718: crash-safe stores (kosmos#8718)

## Goal
A store a crash left empty or all zero bytes must not hold a feature off. A new raw in-place store write must not slip in unseen.

## Decided (on the card, comment 6994673956)
- A start-up check in the board (engine/tornstores.js, called from server.js in onListening, after the bind (a second launch that loses the port never scans), only when server.js is the board) scans the data root for torn stores: `.json` empty or all zero bytes, `.jsonl` all zero bytes. Each moves into `torn/<time>/<same path>`, one board.log line each, a `reset.json` record. Nothing deleted.
- Left alone: damaged-but-real content (keeps failing closed), files changed in the last 5 s (a live writer), symlinks, files over 8 MiB, top-level folders a person fills (attachments, downloads, filepreview), worlds/ (other Kosmoses' data roots and their people's project and agent folders), bin/runtime/torn, anything deeper than 3 folders.
- Key and token paths are named louder in the log line; nothing regenerates them here.
- A ratchet test (engine/rawwrites-8718.test.js) on the per-file count of raw `writeFileSync(` in server.js and engine/*.js: outside comments, exact match to a baseline (135 in 79 files on 11-18); it sees only that one form.

## Rejected
- Editing each of ~273 readers that fail closed.
- Deleting torn files (destroys evidence, irreversible).
- Treating any unparseable file as torn.
- A board UI notice in this PR: the log line + record ship now; the on-screen notice needs design shots and goes to a follow-up card.

## Weakest premise
That a store's absent default is safe. A person's "off" zeroed by a crash comes back as the default; unrecoverable from zeros, so the log names the file.

## Tests
- engine/tornstores-8718.test.js: shapes moved/kept, log lines, record, idempotent second run, clean root, missing root, a real fail-closed reader (phonenotify.masterChoice off -> unset), server.js wiring, SIGKILL mid saveFlushed leaves a whole file.
- engine/rawwrites-8718.test.js: ratchet + control.
- Mutations run: no-zeros, no-skip-dirs, no-recent, no-wiring each red; ratchet red on an added raw write.
- tools/windows-tests.js ALSO gains the test (windows-tests-1777 guard).

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
