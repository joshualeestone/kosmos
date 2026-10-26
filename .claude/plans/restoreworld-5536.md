# restoreworld-5536: the Restored world, and restored agents listed (kosmos#5536 slice 4b)

Design: #5536 comment 6407859949. Enable path measured on comment 6408905798 (create.installJob works on a folder with
no profile record, and STARTS the agent: enable then bootstrap).

## The call
- `engine/restoreworld.js`, three calls, nothing wired (the restore screen is slice 4c):
  - `prepareRestoreWorld(base, { member, now })`: `worlds.createWorld(base, "Restored: <member>, <YYYY-MM-DD>")`, with
    " (2)" to " (9)" when the id is taken (hidden worlds included, read from the registry), then a new, empty folder
    `restored` (0700) inside the world folder for engine/restoresink.js. If that folder cannot be made the world is
    hidden again and the call says so.
  - `finishRestoreWorld({ base, world, restoreDir, result })`: only after runRestore answered ok and the sink is
    closed, into a world on the list (registry row, not hidden), from the exact `restored` folder, with none of the
    sink's own entries left (record, lock, temp folder). At the top of each root only plain-named folders move; dot
    entries, HEAD, files and links are held back in `restored/held-back-<random>/<root>/` (new each run) and named in `heldBack`, since the
    top of workers or projects sits above every agent and project made in this world later. Each root then moves by
    one rename into the world's empty folder. Every check runs before anything moves; one answer shape on every path,
    with `failedFiles` and `fetchProblems` from the restore.
  - `listRestoredAgents({ base, world, restoreDir })`: each folder in the world's workers and in `restored/agents`,
    with a `because` when it cannot be enabled (a link; a folder name create.js cannot start; no instructions file; a
    git repository, a .git or a HEAD, in it or at the top of workers; a folder it could not read or read in full) and
    `runs` (dot-entries, CLAUDE.local.md and opencode files, git, linked or non-text briefs, `@` imports, in every brief
    including AGENTS.override.md). `shared` carries the tops of workers and projects and any project with `runs`.
    `more` says the list is incomplete. A world not on the list answers with a `because`. Registers, starts and
    writes nothing; reads are bounded per folder and in total.
- The member's name loses control, format and bidi characters and is cut at 60 code points before it names a world.

## Rejected
- `engine/worldimport.js` for the agents: it needs a store profile (a snapshot has none) and records a start.
- Restoring straight into the world folder: createWorld pre-makes store, projects and workers, and the sink needs an
  empty root.
- Registering restored agents here: installJob starts them, and design 6 says each agent needs its own enable.

## Review rounds (blind, security-focused)
1. B: finish moved a stopped restore (no record or lock check), and a test pinned it. W: start-time files not
   flagged; no Windows rename retry; a create race failed instead of trying the next name; the default name rule
   untested. Nits taken: sink entries by prefix, combining marks capped, a junction on Windows, absolute base in all
   three calls. Deferred: a member named only in non-Latin script gets an id of "restored<date>", so two such members
   share the nine names a day (the shown name keeps their script; rare, and refusal is said plainly).

2. W: imports were seen only at a line start and in the first brief; a brief over 512 KB went unflagged; only parts
   of .claude were listed; folder and kept names were returned raw for the screen; finish trusted the caller that the
   restore succeeded; the sink prefix was compared case-sensitively. Nits taken: the error code in a failed move, the
   put-back failure said, blank-only names fall back. Deferred again: the shared nine-name pool (round 1), and a
   create failure after its registry row was written being read as a clash (the row means the world exists).

3. B: a .git in an agent folder (core.fsmonitor runs when git runs there, which a provider does at start) went
   unflagged: such an agent is now not offered, and a .git at the top of workers blocks every agent. W: entries at the
   top of workers and projects, and project folders with start-time files, are now returned as `shared`; a world
   folder left on disk under the chosen id is hidden and the next name taken. Nits taken: a brief is read only if the
   opened file is the one lstat saw; a linked brief is named. Deferred: Atomics.wait pauses up to about 2.8 s on
   Windows (the sink does the same); a member name can carry a date that reads like the world's, and two folders can
   share a label (4c tells rows apart by `folder` and shows the world's creation time).

4. W: the git checks were case-sensitive (APFS and NTFS read .GIT); the start-time list named only some providers, so
   it is now every dot-entry; `(@file` imports and UTF-16 briefs went unseen; a leftover world that could not be
   hidden stayed listed (now the restore stops); the world folder itself was not checked for a link. Contract stated
   instead of a refusal: hooks and MCP servers are often wanted, so the screen must have `runs` and `shared`
   acknowledged before enabling. Deferred: reserved Windows names (cannot exist on NTFS), a FIFO swapped in after
   lstat (restored data is static), Atomics.wait (as the sink).

5. W: plain start-time names were matched case-sensitively and missed opencode.jsonc and Codex's AGENTS.override.md
   (now a brief, read and checked); one cap covered agents and shared, so the contract now says nothing is enabled
   while `more` is true; a project's git folder is shared, not refused, and the contract now says why; the Gemini
   residual was understated. Tests added for a move failing part way, finishing again, the cap, and the folded names.
   Nits taken: the listing checks the world folder for a link; a top-level .git is read before any capped loop.
   Deferred: `more` can be set when only skipped entries remained (it errs toward saying the list is incomplete);
   readBrief's identity refusal has no test (it needs a swap between two system calls).

6. W: finish moved a restore that runRestore answered ok with some files failed and said nothing (now `failedFiles`);
   finish trusted any world id with a folder (now it must be in the registry); the contract now says an empty `runs`
   is not "safe" and that labels can look alike. The NTFS .git aliases are refused upstream by restoresink.js
   plainSegments, now said at the check. The shared nine-name pool is filed as #7181. Deferred: O_NOFOLLOW and
   O_NONBLOCK (the #1732 guard refuses POSIX-only flags; the identity check covers a swapped link).

7. B: git reads a folder holding HEAD, objects and refs as a repository with no .git (safe.bareRepository defaults to
   all), so that layout reached core.fsmonitor past every git check: it now counts as a git folder in an agent, at
   the top of workers (by lstat on exact names, the filesystem's own case rule) and at the top of projects. W:
   failedFiles missed backuprestore's failedNotListed; the listing read every entry and brief with no bound (now
   MAX_ENTRIES_READ per folder through opendir, and a 32 MB brief budget per listing); a git folder at the top of
   projects was shown without its reason. Nits taken: the listing requires a registry row, a busy registry lock asks
   to try again, lone surrogates are stripped, the contract says `more` can be forced. Deferred to 4c: showing the
   commands a hook or MCP file runs (engine/startcommands.js commandsIn), and starting agents with
   safe.bareRepository=explicit as a second guard. Not armed by a test: the lone-surrogate strip (the budget gained one in round 9).

8. W: finish read any lstat failure on a restored root as "no such root" and could finish an unreadable restore as
   empty (now only ENOENT skips); finish and the listing accepted a hidden world (now refused: it is off the list); a
   folder padded past the read limit could hide its start-time files (such an agent is now refused and the list says
   `more`). Nit: a comment had moved to the wrong constant.

9. B: git also reads HEAD plus a commondir file naming objects and refs elsewhere as a repository, past round 7's
   check; any top-level HEAD now counts as git (stricter than git, which errs toward refusing). W: briefs and
   start-time files at the top of workers and projects load for every agent below and were shown with no reason; both
   tops now get the full runs check in a "folder itself" row. The NTFS alias comment now says it holds for what the
   restore wrote. Nits: a reflowed doc line; the lstat check named as the one that counts; the brief budget now has a
   test through opts.briefTotal.

10. W: readBrief's identity check compares nothing where a filesystem reports no inode (FAT on Windows), so such a
   brief is now refused as unreadable rather than read unverified (no test: macOS volumes all report one); finish now
   carries runRestore's fetchProblems (the files they cost are already in failedFiles, checked in backuprestore).
   Deferred as duplicates: nested folders (round 5's residual); git at the world folder (Kosmos-made, fresh-checked at
   creation, same-user residual, added below).

11. W: a leftover world that could not be hidden stayed on the list unnamed (the refusal now names it, and the test
   checks the registry); runsIn failed open on a folder it could not list (git is now asked by lstat anyway, and such
   an agent is refused); a project's git row carried no reason (now it says git runs its settings there). Nits: the
   "hidden again" sentence is now true on both paths; a lone .DS_Store in an empty target no longer blocks finish.
   Deferred: finish and keptIn read the restore folder unbounded (the restore wrote every entry first).

12. W: an @ before a path after a letter or a dot went unseen (now any @ before /, ./, ../ or ~/ counts); the listing
   followed a restore folder swapped for a link (now checked); the .DS_Store removal could follow a swapped target
   (re-checked first, no test: a race); a failed move called a link in the target's place "could not be put back"
   (now said as it is, no test: a race); leftover folders taking every name read as "already 9 restored" (now said).
   Deferred: other providers' instruction names (QWEN.md and the like; the contract already says an empty `runs` is
   not safe and 4a shows every file); the nine-name pool (#7181).

13. B: finish moved the tops of the restored roots wholesale, so a hostile workers/.git, HEAD or CLAUDE.md sat above
   every agent made in the world later, unreviewed: the tops are now held back (only plain-named folders move). W: a
   refused listing read as an empty restore (now a `because`); an unreadable agents folder vanished silently (now
   `more`). Nits: dot-entries no longer get a duplicate empty row; every finish answer has the same shape; this
   section of the plan was brought up to date.

14. W: a snapshot chooses its own root names, so it could supply `restored/held-back` and block every finish; the
   held-back folder is now `held-back-<random>`, made new (non-recursively) on each run, so it cannot be supplied in
   advance and an earlier run's folder never blocks a rerun. Nits: a fused comment removed; more blank characters
   stripped from labels; the import pattern's line handling and the brief budget's overshoot of one brief are said.
   Deferred: the check-then-move window (the residual below).

15. W: node_modules at the top of workers moved in, where npm resolves packages for every agent folder below (now
   held back with dot-entries and HEAD). Deferred with the contract stated: a project's own .git moves with it
   (restoring a repository whole is the point; it is shown in `shared` with its reason, and agents made later must
   be started with git hooks and fsmonitor off, 4c). Nits: heldBack reads only this run's folder (a snapshot can name a
   lookalike); kept no longer lists this run's held-back folder; agents kept elsewhere are named in the contract as
   never to run git; two dead checks removed.

## Residuals, stated
- A restored project keeps its own .git, so a hostile repository config there reaches any agent made in this world
  later, which never passes this review. 4c must start agents in a Restored world with git's hooks and fsmonitor off.
- Git discovery walks above the workers folder into the world folder and its base. Both are made by Kosmos and the
  world folder is checked fresh when created; nothing re-checks them after the move.
- Between finish's emptiness check and its rename, another process of the person's own (an agent already running in
  the new world) could write into a target; rmdir then fails and the failure is reported, nothing is lost.
- Nested briefs are not scanned. Claude Code reads a subfolder's CLAUDE.md when an agent works there, and Gemini CLI
  loads every GEMINI.md below its folder when it starts, so for a Gemini agent they load at start unflagged. 4a's
  review list shows every file's content, nested briefs included; that is what covers them.
- A restore that stops is never finished: it stays in `restored` and continues there (slice 3). Nothing here cleans it.
- A rename failing part way leaves workers moved and projects not; `moved` says which. Re-running finish moves the
  rest, since the moved root is gone from `restored`.
- Agents kept outside the workers folder (`restored/agents/<id>`) are listed and cannot be enabled where they are.
- Enabling (4c) must run installJob under THIS world's roots (installJob uses the active world's workers folder).

## Weakest premise
That an agent with a job and no profile row shows on the board like any other once enabled. installJob writes no
profile; the board may learn of it another way (discover/connect). 4c must check this before offering enable.
