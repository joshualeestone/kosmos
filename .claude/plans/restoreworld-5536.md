# restoreworld-5536: the Restored world, and restored agents listed (kosmos#5536 slice 4b)

Design: #5536 comment 6407859949. Enable path measured on comment 6408905798 (create.installJob works on a folder with
no profile record, and STARTS the agent: enable then bootstrap).

## The call
- `engine/restoreworld.js`, four calls, nothing wired (the restore screen is slice 4c):
  - `prepareRestoreWorld(base, { member, now })`: `worlds.createWorld(base, "Restored: <member>, <YYYY-MM-DD>")`, with
    " (2)" to " (9)" when the id is taken (hidden worlds included, read from the registry), then a new, empty folder
    `restored` (0700) inside the world folder for engine/restoresink.js, and the mark `restored-world.json` in the
    world folder (which a snapshot never writes). If either cannot be made the world is hidden again and the call says
    so.
  - `finishRestoreWorld({ base, world, restoreDir, result })`: only after runRestore answered ok and the sink is
    closed, into a world on the list (registry row, not hidden), from the exact `restored` folder, with none of the
    sink's own entries left (record, lock, temp folder), only into a world carrying the mark, one finish at a time (a
    lock in the world folder, built whole and renamed into place, taken over when stale). At the top
    of each root only plain-named folders move; dot entries, HEAD, node_modules, files and links are held back in `restored/held-back-<random>/<root>/` (new each run) and named in `heldBack`, since the
    top of workers or projects sits above every agent and project made in this world later; the held-back folder's
    name is recorded in the world folder, so a lookalike from the snapshot is never reported. Each root then moves by
    one rename into the world's empty folder. Every check runs before anything moves; one answer shape on every path,
    with `failedFiles` and `fetchProblems` from the restore.
  - `listRestoredAgents({ base, world, restoreDir })`: each folder in the world's workers and in `restored/agents`,
    with a `because` when it cannot be enabled (a link; a folder name create.js cannot start; no instructions file; a
    git repository, a .git or a HEAD, in it or at the top of workers; a folder it could not read or read in full) and
    `runs` (dot-entries and the start-time dot-names asked by exact name, CLAUDE.local.md, opencode files and
    node_modules, git, linked or non-text briefs, `@` imports, in every brief
    including AGENTS.override.md). `shared` carries the tops of workers and projects and any project with `runs`.
    `more` says the list is incomplete. A world not on the list answers with a `because`. Registers, starts and
    writes nothing; reads are bounded per folder and in total.
  - `isRestoredWorld(base, world)`: whether the world carries prepare's mark. Every agent start path in 4c checks it
    and starts git with hooks and fsmonitor off there.
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
   safe.bareRepository=explicit as a second guard. Not armed by a test at the time: the lone-surrogate strip (armed in round 23).

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
   lookalike; superseded in round 19 by the record of every run's folder); kept no longer lists this run's held-back folder; agents kept elsewhere are named in the contract as
   never to run git; two dead checks removed.

16. W: HEAD, node_modules and the plain start-time names were matched by toLowerCase, but a case-insensitive
   filesystem may fold further (the long s, U+017F); each is now also asked of the filesystem by exact name, with
   file identity compared (the test runs only where the filesystem folds it); `kept` is capped with a marker. Nit:
   the header's "one volume" now says what a mount inside the world would do. Deferred: the check-then-rename window
   (the residual below).

17. W: on a filesystem that ignores zero-width characters (HFS+), a name with no leading dot can open as .git or a
   provider's dot-name, passing both the hold-back and `runs`; both now ask the filesystem for those exact names
   (no test: APFS keeps such names apart, so this Mac cannot make one). Nits: readBrief refuses a non-file before it
   opens (a FIFO would block); fetchProblems past twenty say so; with no file identity (inode 0) plainFolder decides
   by name only rather than holding back everything; a link at the top of workers has a test.

18. W: heldBack had no cap (now MAX_LISTED with a marker); a node_modules at the top of an agent or project folder
   went unflagged (now in `runs`). Deferred as duplicates: the unbounded read of the restored tops and the rename
   retry wait (round 11's reasoning: the restore wrote every entry first; the sink waits the same way); a create
   failure after its row (round 2). Convention: the object replacement character and variation selectors are
   stripped from labels.

19. W: a rerun after a part-way failure no longer named what the first run held back (each run's held-back folder is
   now recorded in the world folder, which a snapshot never writes, and heldBack reads every recorded one); two
   finishes could run at once (now a lock in the world folder; a dead process's lock is taken over). Nits: a hidden or
   unlisted world's refusal now says so; the workers folder's own row gives the git reason; the variation selector
   supplement is stripped from labels; the doc comment and this plan name node_modules.

20. W: the finish lock could block for ever (a crash between making it and writing the pid left a pid-less lock; a
   recycled pid looked alive): a pid-less lock or one older than ten minutes is now stale, and a failed pid write
   removes the folder; a lock that could not be made read as "already under way" (now its own refusal with the error
   code). Nits: a stale lock is renamed aside before removal so one taker wins; .opencode joins the exact-name list;
   dir is computed once; the tests' name rule is create.js's own.

21. W: the finish lock could be stolen in the moment between making it and writing its pid (now made whole in a
   temporary folder and renamed into place, so it never exists without its pid; a pid-less lock is stale only after
   30 s); release removed whatever lock was there (now only one still holding its own pid; no test, it needs two
   finishes overlapping across the ten-minute stale line). Nit: why the held-back folder is recorded before the
   moves. Deferred as duplicates: a project's own .git (round 15) and other providers' instruction names (rounds 4,
   12).

22. W: the lock and record renames had no Windows retry (now renameRetrying); a failed record write left an
   unrecorded held-back folder that later runs listed as kept (the record is now written before the folder is
   made). Nits: indentation; the contract says `dir` is never shown and folders that already have a profile are left
   out; the test's dead pid is one no system hands out; the release comment says what it guarantees.

23. W: two takers of one stale lock could each move the other's work aside (after its rename, a taker now checks
   that what it moved holds the pid it judged stale, and puts a fresh lock back; no test, it needs two takers between
   two system calls); the busy refusal now says a stopped finish frees the lock within ten minutes. Nit: the lone
   surrogate strip now has a test. Accepted as fail-closed: a transient registry read error during naming reports
   "could not be made" rather than trying the next name.

24. W: the Restored world is on the list from prepare, so an agent or project the person makes there before finish
   fills the folders finish needs empty, and finish refuses for good. worlds.js has no way to un-hide a world, so
   hiding it until finish is not open to this slice: the 4c contract now says to keep the person out of a Restored
   world until its finish has run, and the refusal says what happened. Nits: the lock comment says a rename replaces
   an empty folder on POSIX; the lock's first rename is plain, so a held lock answers busy without the Windows retry
   wait; the contract names shell-hook files (direnv, mise) as outside `runs`.

25. W: a live finish could be taken over at the ten-minute line (now it touches its lock between roots, so a live
   finish keeps it young; no test, it needs a finish past ten minutes); a failed hold-back now says finishing again
   carries on. Nits: temporary lock and record files a crash left are swept when a lock is taken, once older than the
   stale line; the plan names the inode-0 fallback; round 15's superseded sentence is marked.

26. W: nothing marked a world as Restored, so the ordinary start path for an agent made there later had no way to
   know to start git with hooks and fsmonitor off; prepare now writes `restored-world.json` in the world folder
   (which a snapshot never writes) and `isRestoredWorld` reads it, named in the contract as the check. Nits: a
   held-back folder whose name collides is taken back out of the record; the three-taker lock race is stated at the
   code.

27. W: plainFolder asked the filesystem for every reserved name once per entry (now once per root, so an entry costs
   one lstat); labels kept unassigned code points that draw nothing (now stripped). Nit: the comment says the one
   prefix check covers the sink's record, lock and temp folder. Deferred as duplicates: the unbounded read of the
   restored tops (round 11) and the 4c start-path guard (rounds 15, 26).

28. (default model) Nits taken: a finish refused after an earlier one held something back answered `heldBack: []`
   (now every refusal after the folders are known reports what is already held back, counted and moved); finish
   moved into any listed world with a `restored` folder (now only one carrying prepare's mark, so the hooks-off start
   path applies to what it moves); a contract comment line ran past 120 columns (reflowed). Deferred as duplicate: ids
   that fold together share the nine names a day (round 6, #7181).

29. (sonnet) Nits taken: on a case-insensitive filesystem a listed `.GIT` and the `.git` gitIn finds made two rows for
   one folder (now compared folded); "The call" did not name the mark, isRestoredWorld, the finish lock or the
   held-back record (now it does). Not taken: the put-back target folder uses the default mode (createWorld makes it
   with the same default). Deferred as duplicates: the 4c start-path guard (rounds 15, 26) and keeping the person out
   of the world until finish (the contract, round 24).

30. (default model) Nits taken: the finish lock's heartbeat ran only between the two roots, so a long hold list on
   Windows (seconds per rename retry) could outlive the ten-minute stale mark (now a beat per held-back entry and
   before each root's move; no test, as for the heartbeat before); the module header now says every call is
   synchronous and 4c runs them off the board's event loop; the lone-surrogate listing test says it bites only on
   Windows (the worldName half tests the strip everywhere). Not taken: a tab or newline in a member's name joins the
   words it separated (a control character in a name is not a real name, and the test pins the strip). Deferred as
   duplicate: ids that fold together share the nine names a day (round 6, #7181).

31. (sonnet) Nits taken (comments): an unreadable registry reads as no ids taken, and why that is safe; create.js
   freezes store.ROOT on first require, so 4c sets the root before its first listing. Not taken: the day rolls over
   at local midnight (it matches the date the name shows). Deferred as duplicates: the 4c start-path guard (rounds
   15, 26) and the window before the mark exists (the keep-out contract, round 24).
   Arms (rounds 28 to 30, one run): 85 of 86 red; the one green was isRestoredWorld's link check, and it showed the
   check failed OPEN (a world folder swapped for a link read as not Restored, so a start path would run git with
   hooks on there). Now it fails closed (a folder that is a link or a file reads as Restored; a missing one does
   not), with the test, and the arm aimed at the new line.

32. (default model) W: isRestoredWorld still failed open on any error but a link (EACCES, EMFILE, ELOOP) and on a mark
   that is not a plain file; now only a certainly absent folder or mark (ENOENT, ENOTDIR) reads as not Restored,
   tested with a folder mark and a folder with no search bit. Nits taken: the listing offers nothing in a world
   prepare did not make (an ordinary world's live agents are not restored ones); the module header names
   isRestoredWorld. Not taken: heldBack can be the cap plus its "(more not listed)" marker, by design, as kept is.
   Deferred as duplicate: ids that fold together (round 6, #7181).

33. (sonnet) W: isRestoredWorld read a world it could not place (no world, a relative base) as not Restored, the
   fail-open the doc says it avoids; now Restored, tested. W: prepare's createWorld and hideWorld hooks sit in the
   production options; the contract now says 4c builds opts by hand, never forwarding a request's object (weakest
   premise: that 4c reads the contract; a test-only setter, as restoresink has, would enforce it, rejected for now as
   a wider change to six tests in a slice that wires nothing). Deferred as duplicate: the three-taker lock race (stated
   at the code, round 26). Not issues, as the reviewer found: answer()'s dir is checked on every path above it today;
   plainFolder and readBrief differ on ino 0 (readBrief is the stricter); the held-back temp name is reused under the
   lock and swept.

34. (default model) W: round 33's change read the default world (no folder of its own) as Restored, so every agent on
   a computer that never restored anything would start with git hooks off; the default world now reads as not
   Restored, tested. Nit taken: one predicate served two gates with opposite safe directions; the hooks decision keeps
   isRestoredWorld (doubt reads Restored), while finish and the listing now need markCertainlyPresent (doubt reads
   no, so an ordinary world is never treated as restored), tested with a mark that is a folder. Not taken: the three
   EXCUSED entries share one text (the file's existing pattern for sibling exports).

## Residuals, stated
- Three finishes of one world within the same instant can defeat the stale-lock put-back and overlap.
- On a filesystem that reports no inode (FAT, exFAT), plainFolder decides by name alone: the identity check that
  catches further folding cannot run there.
- A Restored world opened and used before its finish cannot be finished (its folders are no longer empty); the 4c
  screen must keep the person out until then.
- The import pattern flags an @ after a letter only before a path (/, ./, ../, ~/). A provider that accepts an @
  inside a word for a file in the same folder (x@notes.md) is not flagged; such a file is inside the agent's own
  folder, which 4a's review list shows.
- A node_modules or .git nested deeper inside a moved project is not reported; npm and git find them when an agent
  works there. 4a's review list shows every file, and 4c's agent start (git hooks off) covers the git case.
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
