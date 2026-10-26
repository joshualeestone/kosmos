# storecheck-7248: name a JSON store a crash left damaged, at board start (kosmos#7248)

## Finished looks like
At board start, any of Kosmos's own JSON stores that is empty, all-NUL or unreadable is named in board.log and on the
person's screen, with what it holds; the newest good copy is offered when one exists; nothing is changed by itself.
Done when (card): a test writes an empty file and an all-NUL file in place of two stores, boots the board, sees both
named in the board log and on the screen, and nothing else is touched.

## Facts the design rests on (a read-only map, 2026-10-26)
- No central list of stores: ~100 files and folders, each owned by its module. No shared reader.
- Several readers treat a damaged store as empty and a later write replaces it (profiles, settings, worlds.json,
  room-seen, sender tokens): so the check runs FIRST in the start block, before anything reads a store.
- Kosmos keeps NO local backup of any store; the Kosmos+ backup leaves the data root out. The only good copy that can
  exist is a crash's leftover write temp (`<file>.kosmos-<pid>-...tmp`, engine/securewrite.js) that still reads, or a
  .bak/.prev beside it. securewrite deletes a dead writer's temp on the next write into that folder.

## Built
- engine/storecheck.js: scans every .json in the data root, the store folders (profiles, commitments, sendertokens,
  webhooks, community, communitysend, catalogue, remote) and the base worlds.json; classifies empty / nul /
  unreadable; names what each holds in the person's words; finds the newest good copy and, if it is a crash temp,
  keeps it as `<file>.recovered-<when>` (exclusive create, never over anything). One board.log line per file, said
  relative to the data root (no home path).
- server.js: atStart first in the start block (never fatal); GET /api/board/damaged-files, POST .../restore (the
  person's button only: the damaged file is copied aside as `<file>.damaged-<when>`, then the copy goes in by a write
  and a rename; refused if the store reads again, or the copy no longer does), POST .../dismiss (until the next start).
- web/index.html: #damaged-slot note in the notices strip (the restart note's style): a row per file, a Put back
  button when a copy exists, says when an action did not work; checked at load and when the board restarts.

## Decided
- A fixed list of folders plus every .json in the root, not the whole tree: the root's subfolders also hold per-agent
  logs and caches that are not stores. Weakest premise: a store in a folder not on the list is not checked. Would
  change my mind: a store found damaged in an unlisted folder.
- No backups are created: the card asks to offer one "if one exists", and keeping copies of every store is a separate
  decision (disk, secrets in some stores).
- Restore is the person's act, with the damaged file kept: the card says never overwrite silently.

## Evidence
- server.storecheck-7248.test.js: the card's done-when on the real server (an all-NUL projects.json, an empty
  removed.json, a good settings.json, a crash temp copy): both named in the log and by the route, the copy offered and
  kept byte for byte, every file that was there unchanged. Red with the start call removed. Plus restore on request.
- render-damaged-files-7248 (new, gated): the note at 1280 and 390.

## Review
- Round 1 (.claude/plans/storecheck-7248-review1.md): 0 blockers, 7 warnings, 8 nits. All taken:
  - W1 a kept copy keeps the write's own time (utimes), so a later start says the right "saved at".
  - W2 stores that hold a secret (remote.json, service-keys.json, org-enrollment.json, fed-seal-key.json,
    github-app.json, the sign-ins; the sendertokens, communitysend, remote, backupkeys folders) are named, but no copy
    is kept or offered: a kept secret outlives its revocation. The row and the log say why.
  - W3 POST /api/board/damaged-files/restore is in REMOTE_STEP_UP_EXACT.
  - W4 current() looks again each time: a store saved over since start says so ("Kosmos has saved over it since it
    started") and its copy can still be put back, what is there kept aside.
  - W5 restore and the aside copy are written by store.saveFlushed (flushed, the store's mode, atomic).
  - W6 one sentence shape for every store ("The file with <what> (<name>) <is empty / is blank, as a crash can leave a
    file / cannot be read>."), and the button "Put back the copy saved <when>".
  - W7 the button is busy, not disabled, so focus stays; on success the row takes focus. Red with disabled.
  - N1 an unopenable store and a too-large one are named; a linked store is checked at its target. N2 a copy is lstat'd
    (never a link). N3 a failing worlds base no longer skips the check. N4 log lines carry error codes, never paths.
    N5 the owning module's lock is not taken: documented in restore. N6 the log assertion checks the sandbox path. N7 a
    static test pins the check first in the start block. N8 the browser check presses for real (focus+Enter, click).
- Round 2 (.claude/plans/storecheck-7248-review2.md): 0 blockers, 3 warnings, 6 nits. All taken; round 1's W4 decision
  reversed:
  - W1 put back only while the store is still damaged. A store saved over since start (the person changed a setting) is
    refused, with no button on the page, and the row and the refusal say where the older copy is kept. Never an older
    copy over newer data. A store gone since start is not brought back.
  - W2 the kept-aside damaged copy gets the store's own permissions (chmod after saveFlushed; tested at 0600).
  - W3 webhooks/, agent-permission-settings.json and org-consent.json join the stores with no kept copy (something the
    person can take back); the words say "a key or something you can take back".
  - Nits: a linked store is refused, not replaced through its link; current() re-reads only files up to 1 MB (larger:
    size and time); the sensitive list matches the path relative to the data root (not any file named remote.json),
    dead entries removed; the browser check's refusal is one the board gives; the order test now finds the later start
    calls (communityswitch.migrate, wireDefaultHooks, installSupervisor, syncEveryone) and asserts them after.
