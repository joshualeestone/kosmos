# tornstores-8718: crash-safe stores (kosmos#8718)

## Goal
A store a crash left empty or all zero bytes must not hold a feature off. A new raw in-place store write must not slip in unseen.

## Decided (on the card, comment 6994673956)
- A start-up check in the board (engine/tornstores.js, called from server.js in the board-only block, after the log stamp, before other engine modules start) scans the data root for torn stores: `.json` empty or all zero bytes, `.jsonl` all zero bytes. Each moves into `torn/<time>/<same path>`, one board.log line each, a `reset.json` record. Nothing deleted.
- Left alone: damaged-but-real content (keeps failing closed), files changed in the last 5 s (a live writer), symlinks, files over 8 MiB, top-level folders a person fills (attachments, downloads, filepreview) and bin/runtime/torn.
- Key and token paths are named louder in the log line; nothing regenerates them here.
- A ratchet test (engine/rawwrites-8718.test.js) on the per-file count of raw `writeFileSync(` in server.js and engine/*.js: exact match to a baseline (141 calls, 79 files on 11-18).

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
