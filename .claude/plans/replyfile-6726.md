# kosmos#6726: `kosmos reply --file <path>`

An agent can attach one file it made to its reply to the person. It arrives as the same
attachment a person's own upload is, and downloads from the conversation on this computer and
from the phone page.

## Still live on main (measured at 261f9c7105)

- `cmd_reply` (install/kosmos:2729) took only `--stdin` and words; any `--file` was refused by
  `_text_args` as "not an option of kosmos reply". No attach verb existed.
- `POST /api/reply` (server.js:16822) read only `text`; `keepAgentReply` (server.js:3968) wrote
  `text`, `at`, `from`, never an attachment.
- `kosmos post --file` is refused on purpose (#1955, cli.post-attach-1955.test.js): rooms are a
  different card and are untouched here.

## The person-upload path, end to end (what this reuses)

1. Upload: the page PUTs raw bytes to `PUT /api/agent/<name>/attachment` (server.js:18712),
   `readBody(req, attachments.MAX_BYTES + 1)` (server.js:18723), then `attachments.save(scope,
   owner, {name, type, bytes})` (engine/attachments.js `save`): a copy under
   `<data>/attachments/agent/<safeKey(owner)>/<24-hex id>/<safeName>` plus `record.json`.
   The cap is `attachments.MAX_BYTES` = 25 MB (engine/attachments.js:47).
2. Send: the page posts the message with `attachment`/`attachments` ids; the DM route resolves
   them with `attachments.resolveForMessage(body, 'agent', name, ...)` (server.js:18241 on main)
   and writes the row with `...attachments.rowFields(files.recs)`.
3. Store: `chat.appendMessage` keeps `attachment` and `attachments` on any row
   (engine/chat.js:4014-4017, `keptAttachment`), the agent's own rows included.
4. Draw: the DM renderer draws `pjAttachmentCards(m)` on the agent's row (`m.from`,
   web/index.html:40364) and on the person's row (web/index.html:40425). One reading of the
   files, `pjFiles` (web/index.html:69959). The page reads the thread from
   `GET /api/agent/<name>/thread` (server.js:17620).
5. Download: `GET /api/attachment/<id>` (server.js:18750) by id only, served as
   `content-disposition: attachment`, `nosniff`, `default-src 'none'; sandbox`. The phone page
   is the same page over Kosmos+, and reaches this same route under the session the relay
   admitted; nothing about it changes here.

## What this adds

- `install/kosmos` `cmd_reply`: `--file <path>` / `--file=<path>`, taken out of the args before
  `--` wherever it sits; refuses twice, no path, an option as the path; makes a relative path
  absolute from `$PWD`; words optional with a file; sends `file` in the JSON. A wrong-world board
  does NOT keep a file reply in the outbox (the file is read at send time). A second usage line
  names `--file`; the first stays word for word the Windows one (cli.reply-stdin-4582 pins it).
- `server.js` `/api/reply`: `file` must be a string; no words means the file's name is the text
  (as a person's wordless upload); a forwarded (remote) request may not attach; after the sender
  is resolved, `engine/replyfile.js attach(who, file)`; `keepAgentReply(..., {files})` spreads
  `attachments.rowFields`; a copy whose reply was not kept is discarded.
- `engine/replyfile.js` (new): the checks and the copy.
- `engine/dmfiles.js`: the "Where to save files you make for the person" block teaches
  `kosmos reply --file` (not on a win32 board: the Windows `kosmos` does not take --file yet).

## Security rules, as built

- Absolute path only; any `..` segment refused before resolving.
- Decided on `realpath` (every link followed): a regular file (folder, FIFO, device refused)
  either DIRECTLY in `dmfiles.filesDir(who)`, or inside a project folder whose DEEPEST containing
  project lists `who` (a nested project the agent is not on is refused).
- No hidden segment between that root and the file (`.env`, `.git/...`).
- An empty file is refused (as a person's empty upload is: attachments.save says "there is nothing
  in that file").
- Size from stat, over 25 MB refused before reading; then opened with `O_NOFOLLOW`, the open
  file must be the same dev/ino, and one byte past the cap is read so a file that grew is refused;
  the bytes read must equal the descriptor's size exactly, so one that shrank is refused too (r7).
- Stored as a COPY through `attachments.save`; served only by id from the store.
- No new route. A forwarded request with `file` is refused.

### Review r1 (applied)

1. Paths are compared in their on-disk spelling: `realpathSync.native` for the file and the Files
   folder, as `projects.resolveReal` reads project folders. The JS `realpathSync` keeps the
   caller's case and Unicode form, so `/X/A/b/f` dodged a nested project at `/X/A/B` (and NFD vs
   NFC the same), and a Files folder typed in another case was falsely refused.
2. The Files folder must be a real directory (lstat, not a link) whose real path is its real
   parent plus its own name; otherwise it is no root at all.
3. A hard link (nlink > 1, on the stat and again on the opened fd) is refused, so a file from
   elsewhere cannot be sent under a name in the agent's folder.
4. The open adds O_NONBLOCK, so a FIFO swapped in after the stat cannot block the event loop.
5. A file is attached only when the sender was named by its AGENT token (corrected in r2, finding
   2: the board token was accepted here first). Then the sender is the token's agent and its folders
   are the ones judged, whatever pane the body names.
   - Closed: a pane name alone (guessable by any process of this user) cannot attach; the board
     token cannot either, since it names no agent and every agent of this user can read it, so it
     would let agent A send agent B's file as B.
   - Not closed: an agent token is a file this same user can read, so a process that reads another
     agent's token can still send as that agent. That is the reach any same-user process already has
     over the other agents' files; the route adds no new one.
6. A stored copy is discarded when the keep returns not-kept AND when it throws (try/catch).
7. The CLI refuses a path with any control character (after making it absolute), with a sentence;
   only `\` and `"` need escaping then, so the JSON is always valid and non-ASCII passes as written.
8. Per-agent daily cap: `DAILY_BYTES` = 200 MB per rolling 24 hours (engine/replyfile.js), kept in
   an in-memory per-agent ledger (r2 finding 4) seeded once from the store's records at boot (and by
   the first reply if boot did not), added to on each attach, taken off by `discard`. No reply walks
   the store. It is a BRAKE AGAINST MISTAKES AND RUNAWAY LOOPS, NOT A SECURITY BOUND: the store is
   writable by every process of this user, so an agent set on sending more can rewrite the records a
   seed reads. Counted from the records `attachments.save` now records `by: 'agent'` on a reply copy, and
   only those count (a person's uploads into the same conversation never do). Why 200 MB: eight
   files at the 25 MB per-file cap, far above a day of handing a person what was made for them,
   while bounding how much one agent can copy into the store, and send off this computer through
   the conversation, in a day. One constant to change if that proves wrong.
9. Every refusal test asserts the WHOLE attachment store (every scope and owner) is unchanged.

## Cap decision

25 MB, the person-upload cap, as the lead asked. The card's own example (a 40 MB video) is
REFUSED, with a sentence telling the agent to say where the file is saved. Why not raise it here:
the download route reads the whole file into memory per request, the phone path goes through the
Kosmos+ relay whose size limits live in the private relay repo and are not measured here, and the
person-facing copy says 25 MB is "the most a conversation can carry". Raising it is its own card:
stream the GET, measure the relay with a 40 MB body, then raise `MAX_BYTES` for both directions.

## Tests

- server.reply-file-6726.test.js: happy path (row record name/size/type/kind, the page's thread
  read carries it, byte-identical download, edit and delete of the original change nothing),
  project folder, no words, control, and refusals: remote, outside, link out, `..`, folder,
  FIFO, device, oversize (sparse), missing, relative, Files subfolder, hidden, another agent's
  Files, nested project, non-string.
- cli.reply-file-6726.test.js: both spellings, relative to absolute, late flag, past `--`,
  no words, usage, refusals, the board's refusal, wrong world.
- Red arms (scratchpad redarms-6726.py): each mutation applied once (refused if its target is not
  exactly one occurrence), the test file run, the file restored and compared byte-equal.

| arm | mutation | result |
|---|---|---|
| S1 | no `..` refusal | red |
| S2 | containment always allows | red |
| S3 | containment on the given path | red |
| S4 | no folder refusal | red |
| S6 | no size refusal | red |
| S7 | hidden segments allowed | red |
| S8 | remote may attach | red |
| S9 | row carries no attachment | red |
| S10 | shallowest project wins | red |
| S11 | served from the original by link | red |
| S13 | missing file worded as unreadable | red |
| S14 | words not defaulted to the name | red |
| C1 to C7 | CLI: relative path, wrong world, file not sent, twice, words required, `--`, usage | red |
| R1 | JS realpath (caller spelling) | red |
| R2 | Files link followed as the root | red |
| R3a | only the stat nlink check removed | **green, expected**: the second check on the opened fd still refuses the hard link. The two are a deliberate pair (the fd check also covers a link made between stat and open), so removing one alone is not a defect a test should see |
| R3b | both nlink checks removed | red |
| R4 | no O_NONBLOCK | red (on the flag assert, before any open, so it cannot hang) |
| R5 | pane-only may attach | red |
| N6a / N6b | thrown keep / not-kept reply leaves its copy | red / red |
| N7 | control characters pass the CLI | red |
| N8a to N8d | no cap / person uploads count / no window (seed and read both) / copies not marked | red |
| W1 | kept roots (data, workers, own folder, .config, .ssh) not refused | red |
| W2 | a project at the home folder allowed | red |
| W3 | a project holding the data root allowed | red |
| W4 | a project holding the workers root allowed | red |
| W5 | ~/.ssh not kept | red |
| W6 | the board token attaches again | red |
| W7 | the store walked per reply instead of the ledger | red |
| W8 | a discarded copy still counts against the day | red |
| W9 | stored under the link's name | red |
| W10 | folders judged by the pane, not the token | red |
| X6 | wordless text not the saved name | red |
| X7 | no second resolution after the open | red |
| Xa1 / Xa2 | roster agents not kept / route passes no roster | red / red |
| Y1 | hidden folders of home allowed | red |
| Y2a / Y2b / Y2c | Library allowed / no cloud carve-out / legacy root not kept | red / red / red |
| Y3 | only the home folder itself is wide | red |
| Y4 | no re-stat after the re-resolve | red |
| Y5 | the seam arms outside a test | red |
| Y2d | all of Mobile Documents open (not only CloudDocs) | red |
| Y6a / Y6b | the board does not name the saved file / the command says the given name | red / red |
| R1 (r4) | JS realpath again | red, on the on-disk-name test (identity now does the containment, so the case and NFD refusals hold without it) |
| Z1 | compare by spelling again | red |
| Z3a to Z3d | connected agent kept whole / its Files, Inbox, brief not kept | red each |
| Z4 | container Documents closed | red |
| Z5 | escaped saved name printed cut | red |
| G1 | setRealpathForTests not excused (engine.reachable.test.js) | red |
| G2 | the open flags not classified (windows-coupling-audit-1732) | red |
| V1 | wide decided only by canonical ancestors | red |
| V2a / V2b / V2c | start.log / brief backups / other runners' briefs not kept | red each |
| V3 | the agents read three times each per attach | red |
| V4 | a container's Documents opens to any project | red |
| V5 | hidden names in the given path allowed | red |
| V1 (r6) | the chain layer removed, rootHolds alone | green, expected: rootHolds covers every case tested; the chain layer is the second of a pair |
| R6a | rootHolds removed, the chain layer alone | red (the volume root's files outside home) |
| R6b | the hidden rules reach the Files folder | red |
| R6d | the seed parses old record folders | red |
| T1 | a shrunk file is sent cut | red |
| T2 | the first project on a shared folder decides | red |
| (none) | readOwn without `given` | not armed: a missing given also fails the re-resolve, so the required-check is a second layer with no separate behaviour |
| W3, W4 (r5) | now remove BOTH layers (chain check and ancestor set) for the data and workers roots | red; removing one layer alone stays green, expected: the two back each other up, as R3a's pair does |

### Review r2 (applied)

1. A project the agent is on reaches nothing Kosmos keeps (an agent can adopt any existing folder as
   a project, and a person can make one at ~/work). For a project-rooted file: refused when its real
   path is under the data root (store.ROOT), the workers root (every agent's folder, the sender's
   own too: its Files go only through the Files rule), the sender's own recorded folder, or
   ~/.config or ~/.ssh; and a project whose root is the home folder, or holds the data root or the
   workers root, gives nothing at all. Roots are read per call (environment-set).
2. Agent token only (see 5 above).
3. The route arms run on an enforcing board (on=true, a board token held); one arm runs on=false with
   no token (only the agent token attaches); a cross-agent arm sends leo's token with mara's pane
   and the file attaches as leo, from leo's folders, never mara's.
4. The in-memory ledger (see 8 above).
5. The stored name is the real file's basename, so a link report.pdf to notes.txt is notes.txt
   (name and type then agree; the lead accepted this over given-name-with-real-type).
6. With no words the text is the SAVED record's name (safeName cuts to 160 characters and renames
   record.json and preview.png), so the bubble never shows a second spelling beside the card.
7. After the open the given path is resolved again and must equal the checked real path; with the
   fd's dev/ino compare, a folder above the file swapped in that instant is refused too. Tested
   through a realpath seam that answers differently the second time (no race needed).
8. (follow-up a) Every agent's own folder is kept, wherever it is recorded: the sender's, each
   roster agent the route passes in, and each agent created on this computer. Read per call.

### Review r3 (applied; the misses were a denylist of named folders, so each is closed as a class)

1. Under the home folder, no hidden segment anywhere in path.relative(home, real), whatever the
   project root (~/.aws, ~/.gnupg, ~/.kube, ~/.docker). A dotfile directly in home is reachable only
   from a project that holds home, which gives nothing (3).
2. ~/Library is app data (Keychains, Cookies, browser profiles, Messages, Mail) and is refused,
   EXCEPT iCloud Drive (~/Library/Mobile Documents/com~apple~CloudDocs) and ~/Library/CloudStorage
   (Dropbox, Google Drive, OneDrive through File Provider): a real Kosmos project can live there,
   since projects.js puts no limit on a project's folder and register.js already treats Mobile
   Documents as a person's place. Raised with the lead before building; the narrower carve-out (not
   all of Mobile Documents, which holds app containers) is the call. The legacy data root
   (AgentWorkforce) is on the kept list too.
3. A project root that is the home folder OR CONTAINS it (/Users, /) gives nothing, wherever the
   data and workers roots live. (r4: decided by identity: the root's dev/ino is among home's and its
   ancestors'.)
4. After the re-resolve, the file now at `real` must have the descriptor's dev/ino. This refuses a
   single swap of a folder above the file between the check and the open; it narrows but does not
   close a DOUBLE swap (Node has no openat walk to hold each folder open on the way down).
   A project in Mobile Documents/com~apple~Notes (an app's container) is refused (tested).
5. setRealpathForTests throws outside a test process: gated on store.isTestProcess (now exported),
   the same answer store.js gates KOSMOS_ALLOW_REAL_ROOT on.
6. The board's reply names the saved file (`attached`), and the command prints that name, so a link
   report-link.pdf to notes-real.txt says "Sent, with notes-real.txt attached".

### Review r4 (applied)

1. Every rule compares by IDENTITY (dev/ino), never by spelling. realpathSync.native leaves
   /System/Volumes/Data/Users/<me> unchanged though it is /Users/<me> (a firmlink), so string
   comparisons could be stepped around. The file's chain (it and every folder above it) is stat'd
   once; the roots are stat'd once per call; "X holds the file" is "X's id is in the chain";
   "the root holds home" is "the root's id is among home's ancestors"; the deepest project is the
   one whose id is nearest the file in the chain; the names below a matched folder (hidden segments,
   the Mobile Documents container and its Documents) are read from the real path.
   How it is tested: a sandbox cannot make a firmlink, so the alias is a SYMLINK and both resolvers
   (replyfile's realOf seam and projects.js's setFsWorldForTests realpath) are set to leave a path
   under the alias as written, exactly as native realpath leaves a firmlink spelling; stat still
   follows the link, so alias and canonical path are the same inode and differ only as strings. The
   test asserts both of those before it relies on them. Red arm Z1 (idOf returns the spelling) reds it.
   realpathSync.native is kept for the NAME the card shows (on-disk case), tested separately.
2. engine.reachable.test.js was red: setRealpathForTests is now excused there by name, with a reason.
   WHY THE SWEEP MISSED IT, plainly: the sweep list was hand-picked by grepping tests for the names
   this change touches (keepAgentReply, /api/reply, cmd_reply, dmfiles, attachments) plus guards I
   named. A whole-repo guard names none of those, so it was never in the list; the run itself was
   from the repo root and its output was read. The same cause hid a second red guard,
   engine/windows-coupling-audit-1732.test.js (the O_NOFOLLOW/O_NONBLOCK flags, red since the first
   commit), now classified like its siblings (captured undefined-safe, two inventory rows). The sweep
   is now a script (scratchpad sweep-6726.sh) that adds every test scanning the repo (readdirSync of
   __dirname, the engine dir or a repo root, or git ls-files), refuses to run if any of five named
   guards is missing from the list, and prints the counts and every failing name: 84 files.
3. A connected agent's recorded folder (outside the workers root) is its own working folder, often a
   person's project: only its Files, Inbox and brief file are kept there. A created agent's whole
   folder is kept (it is under the workers root anyway).
4. ~/Library/Mobile Documents/<container>/Documents is open (an iCloud app's user-visible files, an
   Obsidian vault); the rest of a container (com~apple~Notes's data) stays refused.
5. The command's saved-name read falls back to the given name when the value holds a backslash (a
   JSON-escaped quote or backslash).
6. Comments and the r3-3 claim now describe the identity rule.

### Review r5 (applied)

1. The wide-project check is also decided inside the file's own chain, where the root and home share
   one spelling: home, the data root or the workers root at or below the root's index there means the
   root holds it. The ancestor sets (kept as a second layer) walk the canonical spelling and never
   held /System/Volumes/Data. Tested with home spelled through a link (sys6/Users -> vol6/Users) and
   a project at vol6, which holds home by identity and is not an ancestor of home's spelling (both
   asserted in the test).
2. A connected agent's folder also keeps start.log, every runner's brief name (CLAUDE.md, AGENTS.md,
   GEMINI.md: a runner switch leaves the old file) and each brief's .previous backup.
3. The kept set is computed once per attach with one instructions.fileFor per agent (plus the
   sender's Files folder); tested by counting calls around replyfile.attach (bound: 3 for two agents).
4. A container's Documents opens only to a project whose root is in that container, so a project at
   Mobile Documents or ~/Library opens no app's Documents.
5. The hidden-in-home rule also runs on the path AS GIVEN (absolute, relative to home, before any
   link is followed), so ~/.aws as a link into a non-hidden dotfiles folder is refused by the name it
   was reached through. The older arms that test the rules on the REAL path (~/.ssh kept, ~/.aws and
   ~/.docker hidden, a home dotfile from a wide project) now reach their file through a link with no
   dot in its name, so the given-path rule does not answer for them.

### Review r6 (applied)

1. rootHolds: for each ancestor A of the target's spelling (home, the data root, the workers root),
   the target's path below A joined onto the project root lands on the target itself (by identity).
   That is how /System/Volumes/Data holds /Users/<me> without being an ancestor of home's spelling,
   and it holds files outside home there too (Users/Shared, private/etc). It replaced the ancestor-id
   sets (it covers them: A's own id is the empty-suffix case). The chain layer (r5) is kept as a
   second layer for a spelling whose folder names below the root differ from the target's own; no
   such spelling is known on macOS, so removing it alone stays green (V1, expected). Tested with a
   sandbox "volume root" (vol9, home spelled through sys9/Users -> vol9/Users): a project there
   sending Users/Shared and private/etc files is refused.
2. The three hidden-name rules are one helper (hiddenRefusal) called for project files only, after
   the Files early return, so an agent's own Files folder under a dot folder attaches (tested with a
   recorded folder at ~/.runner/agents/leo), while a project file under a dot folder is still
   refused. A dotfile directly in an agent's own Files folder is no longer refused (the Files rule
   is the agent's own deliverables; decided by the lead).
3. readOwn's `given` is required and the descriptor is fstat'd once.
4. heldBelowRoot computes each findIndex once.
5. The boot seed skips record folders last changed more than a day ago without parsing them.
6. The CLI tests run with a minimal environment (PATH, a sandbox HOME and TMPDIR, the stub's port).

### Review r7 (converged; NITs applied)

1. The read must return exactly the descriptor's size: a file that shrank between the fstat and the
   read was sent cut. Tested by truncating it through the realpath seam's second call (after the
   open, before the read).
2. Several projects on the same deepest folder: the agent is on it if ANY lists it, so the order of
   projects.json never decides. Tested with two projects on one folder, in both orders.
3. Not every agent that receives the Files block has an agent token. Only bin/agent-supervisor.sh
   mints one, for agents Kosmos starts; adopted agents (tmux sessions Kosmos found, launched by their
   own scripts: none of this computer's launch-*-bot.sh sets KOSMOS_AGENT_TOKEN) receive the block too
   (dmfiles.syncEveryone tells every isNamedOurs roster row). So the taught sentence now opens "If
   Kosmos started you (an agent Kosmos started has its own agent token)" and says to tell the person
   where the file is saved when Kosmos refuses it.
4. "An empty file" is in the refusal list above.

The 20 tests the sweep neither passed nor failed are all skips (`ℹ skipped 20`, each line marked
"# SKIP" or with its own skip reason), all Windows-only or needing a real Windows build:
1 in engine/computerprint-5532.test.js, 5 in engine/win32update.test.js, 14 in
tools.windows-kosmos-shims-570.test.js.

## Gaps

- Windows `kosmos` (tools/windows/kosmos-cli.js) refuses `--file` as not an option. Homer's lane.
- The phone download of a near-25 MB file through the relay is not measured here.
- A project rooted directly at a dotfiles folder (one with no hidden name, that ~/.aws links into)
  reaches the same credentials by their real, non-hidden path: no name there says secret, so no rule
  here can tell. The r5-5 test pins this gap as its control arm.
- A double swap of a folder above the file (see r3 4) is narrowed, not closed.
- The kept list is as good as the inputs it reads (projects.json, the agents' profiles), which any
  process of this user can write.
- `attachtext.render` (the office-file text rendering a person's upload gets for the agent) is not
  run: the agent made the file and needs no rendering of it.
