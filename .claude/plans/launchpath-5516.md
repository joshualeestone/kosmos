# launchpath-5516: the token-only guard also protects the folders on the agent's launch PATH (kosmos#5516, part 1)

Stacked on boardkeychain-4491 (#5122); rebased onto main once that merges. Route detail and measurements are kept in
Angel's private notes; this plan stays at the level of the class.

## Finished looks like
A token-only Claude agent's own file tools and shell cannot change what its next start runs or reads as instructions:
the programs on the PATH it starts with, the programs the supervisor starts by path, and the files and folders the start
reads. Anything that cannot be covered makes the guard say it is not whole, and the rest of the guard is still written.

## Built (the model settled in review 16, refined to review 21)
- engine/setup-assistant.js: launchPathDirs and scanLaunch.
  - A folder whose contents run by name is denied whole, in both layers: the PATH folders (the pane's, the board's own,
    two fixed ones), the folders of what the supervisor starts by path, the folder the supervisor's own programs end
    their chains in, the launchd jobs folder and the launch-secrets folder.
  - A program's own file, where its link chain ends, is denied by name in both layers (its folder when its name has a
    character the rules cannot carry). A link to a file, and a spelling written through a folder link, are named to the
    file tools only. A link to a folder gets no rule.
  - Shared folders are never denied whole; ancestors of the agent folder never at all.
- bin/agent-supervisor.sh: abs_path_only cleans the pane PATH; the pane and the guard get the same one, and the guard
  gets the supervisor's own folders and programs (KOSMOS_GUARD_*).
- engine/launchpath-5516.test.js; engine/boardkeychain-4491.test.js pins the launch part so it does not read the host.

## Decided
- Computed at each refresh (board start, and each launch with the pane's own PATH), not from a fixed list.
- Never a partial write: an uncoverable entry is reported, the rest of the guard is written.
- An ancestor of the agent folder is never denied (it would lock the agent out of its own work).
- Deny lists merge, so a path once covered stays covered (only narrows what the agent may write).

## Review log
- Round 1 (opus): 2 BLOCKER, 4 WARNING, 2 CONVENTION, 1 NIT. Fixed, or recorded privately for measurement.
- Round 2 (sonnet): 0 BLOCKER, 5 WARNING, 1 CONVENTION, 2 NIT. Fixed (ancestors, an empty cleaned PATH, the board
  PATH held loosely, a runnable test of the cleaning, public text cut back, one scan per refresh pass).
- Round 3 (opus; a fresh review by Renet Tilley, who took the card over, since round 3's own findings were not recorded):
  - FIXED (BLOCKER): a launch folder with a rule-pattern character no longer stops the whole guard from being written.
    Its file-tool rule is left out and the folder reported (the guard says it is not whole), and the shell layer keeps
    its concrete path. Test with a control; the mutation makes it fail.
  - FIXED: PATH entries that do not exist yet resolve through a symlinked parent (realOrLeaf). Test with a control;
    the mutation makes it fail.
  - FIXED: the comments claim only what is covered.
  - FIXED (W3b): programs the supervisor starts by absolute path from folders not on the pane PATH. Measured: the guard
    did not deny the install's own folders. It now covers this install's engine and bin folders and node's folder (the
    guard runs from the same install). Claude's and tmux's folders are on the pane PATH. Test; the mutation makes it fail.
  - DECIDED, a residual: the code a covered program loads from beside its own folder (a package's lib, a keg's
    dylibs, a script's own tree).
    - Rejected: widening every covered `bin` to its parent. That would deny shared trees such as ~/.local or /usr/local
      as a whole, and could break ordinary tools writing their own state there.
    - Rejected: a package-root rule per layout (npm, Homebrew, Python). It is a list of layouts that drifts.
    - Weakest premise: that this part of the guard closes the "place a new program the agent's next start runs" class
      while leaving the "change a library a program loads" class to a later part. It should be named on the card
      (class-only).

- Round 4 (sonnet): 0 BLOCKER, 4 WARNING, 4 NIT.
  - FIXED (W4a): a PATH entry that is the agent's own folder or inside it (as written, not made yet, or through a link)
    is now removed from the pane PATH by the supervisor, so "cannot cover" no longer means "writable and on the PATH".
    Tests with controls (a same-prefix sibling stays; no folder given removes nothing). Each of the two checks has a
    mutation that makes the test fail.
  - DECIDED, residuals of the same class as round 3's (recorded, not fixed here):
    - folders a shell's startup adds to PATH after the pane starts (rc files, version-manager shims, activation hooks):
      the guard covers the PATH the pane starts with, as its comments say;
    - an interpreter named on a covered script's first line, and programs a covered script calls by absolute path,
      when those folders are not on the PATH.
    Rejected: following every script's interpreter line and callees. It is a parser for every script language, and it
    still could not see paths built at run time. Weakest premise: as round 3.
  - FIXED (W4d): the scan-cap note says the unchecked entries are unknown, not "the first N".
  - FIXED (nit): the per-pass cache key includes the own-program folders.
  - NOT CHANGED (nits): case-insensitive volumes (fails toward over-denying, not a leak); the pane PATH is cleaned for
    every token-only agent (harmless; other runners return "unsupported"); the wiring checks read the source text
    (abs_path_only itself is executed).
- Round 5 (opus): 2 BLOCKER, 5 WARNING, 4 NIT.
  - FIXED (both BLOCKERs): the folder the INSTALLED supervisor runs from (create.supervisorPath(), which also holds the
    engine pointer and the bridges) is now covered, and the test names that folder from create rather than repeating the
    code's own expression. A control checks the fixture can tell it from the source tree's bin. Mutation makes it fail.
  - FIXED: a PATH folder reached through a link is named both ways in the file-tool rules (the sandbox keeps the
    resolved one). Test with a control; mutation makes it fail.
  - FIXED: the supervisor's PATH cleaning and the guard now agree. Ancestors of the agent folder leave the pane PATH
    too, and a not-yet entry is resolved through its nearest existing parent. Each comparison has a mutation that fails.
  - FIXED: tests pin the fixed folders and the install's program folders, so they do not depend on the host.
  - FIXED (nits): the cleaned PATH goes only to claude panes (no second PATH key for other runners; a test checks the
    line); comments corrected; a test for the per-pass cache, which fails if a user changes the cached answer.
  - DECIDED: a guard that is not whole because of a launch folder still refuses creating a token-only agent. That is the
    card's rule (an agent that cannot be guarded whole is not created), and the reason names the folder.
    Weakest premise: an odd folder on the board's PATH blocks every token-only creation until it is renamed or removed.
  - DECIDED, a follow-up: deny lists merge and are never pruned, so versioned install folders (a package manager's
    per-version folders) accumulate after upgrades. Not a hole (it only over-denies stale paths), but the settings file
    grows. Pruning needs a record of which rules were launch rules that the agent itself cannot edit; a follow-up card.
  - NOT CHANGED: boardkeychain-4491.test.js does not pin the launch folders (it is the base branch's file; the real
    fixed list has no pattern characters).
- Round 6 (sonnet): 0 BLOCKER, 3 WARNING, 3 NIT.
  - FIXED: the supervisor also drops, from the pane PATH, an entry with a character the permission rules read as a
    pattern (its file-tool rule is left out, so only the shell layer would cover it) and an entry with a . or .. segment
    (resolved differently by the shell and the guard). A dotted name that is not a segment stays (control). Each part
    has a mutation that makes the test fail.
  - DECIDED, residuals added to the card's list (class-only): a folder whose PATH program links into a folder with a
    pattern character keeps only the shell layer (the guard says it is not whole, at launch and at create, where it
    refuses); and replacing an ANCESTOR of a covered folder is not stopped, since ancestors are deliberately not denied.
    "Covered" means the folder's contents, not that its path cannot change.
  - NOT CHANGED (nits): source-text wiring checks, case-insensitive volumes, the deny-list growth follow-up (all
    recorded above).
- Round 7 (opus): 1 BLOCKER, 7 WARNING, 1 CONVENTION, 4 NIT.
  - FIXED (BLOCKER): what every claude pane starts by absolute path through --mcp-config (the browser tool's tree:
    its script, its config and its browser) is covered, and so is the --settings file (a file rule in both layers).
  - FIXED: each hop of a program's link chain is covered, and a dangling link's folder too (whatever is later made
    there runs by that name). A PATH folder that cannot be listed is reported (a missing one is not). The agent-folder
    comparison ignores letter case on macOS and Windows, in the guard and in the supervisor's cleaning. The supervisor
    drops PATH folders not made yet (the guard is written again at the next start). A program that resolves into the
    agent folder now has a test. The two tests that read the host's folders are pinned. The new block sits above the
    #4491 doc comment again, and the header lists everything reported as uncoverable.
  - Each fix has a mutation that makes a test fail (10 mutations, all red).
  - NOT CHANGED (nits): an agent folder of `/` (not a real layout); `set +f` restored unconditionally (runs in a
    subshell); a source checkout without the report hook script (development only).
- Round 8 (sonnet): 0 BLOCKER, 4 WARNING, 3 NIT.
  - FIXED: the claude and tmux programs the supervisor starts by absolute path (from the plist) have their folders
    passed to the guard (KOSMOS_GUARD_RUN_DIRS) and covered, on the PATH or not; a link there is followed like any
    other. Test with a control; a mutation of either side fails.
  - FIXED: the PATH scan is cached once per refresh pass for ALL agents (it no longer includes the agent folder in its
    key); only the agent-folder check runs per agent, and it never writes into the shared scan. One realpath per
    folder, not per program. Tests (a second agent, and an agent with its own notes) fail under each mutation.
  - FIXED: a test checks that no later line gives a claude pane a second PATH key (the one later PATH line is limited
    to codex, gemini and grok).
  - FIXED (nits): the helper is named for what it does (_phys_dir), and the caller's noglob is put back as it was
    (tested both ways).
  - NOT CHANGED (nit): a PATH folder past the scan cap refuses token-only creation (decided in round 5).
- Round 9 (opus): 1 BLOCKER, 4 WARNING, 6 NIT.
  - FIXED (BLOCKER) and FIXED (W, middle links): every path the guard depends on is followed one name at a time. The
    folder holding a link ANYWHERE along it (not only at its end) is covered, and when that folder is inside the agent's
    own, the guard says it cannot cover it. That closes a PATH entry written through a link inside the agent folder, and
    the "opt"-style layout where a program's target passes through a folder link. The supervisor also drops an entry
    whose written path is inside the agent folder. Tests with controls; each part has a mutation that fails. A link held
    in an ANCESTOR of the agent folder (a system link such as /var in /) is the recorded ancestor residual: never denied.
  - FIXED: a launch input whose place cannot be worked out (the installed supervisor, the browser tool, the settings
    file) is said, so the guard is not whole, rather than silently left out. Test with a control.
  - FIXED (nit): a file named on PATH (ENOTDIR) is skipped like a missing folder, not reported. Test.
  - DECIDED, residual: a PROGRAM whose chain is uncoverable (it lands in or passes through the agent folder) stays on
    the pane PATH; the supervisor drops whole entries only. The guard says it is not whole at launch (logged) and at
    create (refused). Rejected for now: having the guard return the entries to drop, which reorders the launch.
  - DECIDED, a later part of #5516 (named in the header and here): programs named in Claude's own config files (MCP
    servers in .claude.json or .mcp.json, hooks named by settings, plugins, the status line). Only the settings files
    themselves are denied today.
  - NOT CHANGED (nits): tr versus toLowerCase on non-ASCII names (they can only disagree toward "not whole"); the
    supervisor's WORKDIR versus create's workerDir (both fail safe if they differ); the unpinned first test checks the
    real fixed list's rules only.
- Round 10 (sonnet): 0 BLOCKER, 2 WARNING, 3 NIT.
  - FIXED: a ".." after a link applies to where the link leads, as the system does. The walk takes names as written
    and joins a link target as text, so "lnk/../x" is no longer folded to the wrong folder before the link is followed
    (it failed open: the real folder went uncovered). Test with a control; two mutations fail.
  - FIXED (nit): the reason stays readable when one folder names many programs (40 shown, then "and N more"). Test.
  - DECIDED, residual (recorded, not logged): a link held in an ANCESTOR of the agent folder is not reported. Every Mac
    has such links at the top level (/var, /tmp, /etc), so a note would appear on every launch and mean nothing. A link
    in the person's own home folder that a PATH entry passes through is the case that matters; it belongs with the
    ancestor residual, and to a later part if it is to be closed (a deny on the link's own path, not its folder, needs
    measuring first).
  - NOT CHANGED (nits): "/" as a PATH entry is already dropped by the supervisor's ancestor check (a test pins it);
    case-only duplicate rules are harmless.
- Round 11 (opus): 1 BLOCKER, 6 WARNING, 3 NIT.
  - FIXED (BLOCKER, part): what the next start READS as instructions is covered too: tmux's config files (file rules)
    and the launchd jobs folder (each job names the supervisor, claude and tmux; covered, never scanned). Tests.
  - DECIDED (BLOCKER, rest), a later part of #5516: the code in shell startup files (the plan already names rc files),
    with programs named in Claude's own config files. Named in the header.
  - FIXED: the walk's result is put in the disk's own spelling (letter case), which review 9 had lost. Test.
  - FIXED: an alias (a written spelling) is checked against the agent folder in both its spellings and dropped when it
    is in or above it (dropping one is safe: the real path is covered); a spelling with . or .. names is never an
    alias. Tests; each part has a mutation that fails.
  - FIXED: a FILE to deny no longer widens to its whole folder (the settings file had widened to the Kosmos data root).
    Only the file and the folders holding links on its path. Test.
  - FIXED: the supervisor passes the engine and node folders as IT spells them, beside claude and tmux. Test.
  - FIXED: tests for link cycles (with a time bound), the disk spelling, an ancestor alias, and the file folder.
  - FIXED (nits): a throw in the launch scan becomes a "not whole" note, so the rest of the guard is still written; the
    shell test asserts its links exist before relying on them.
  - DECIDED, residual: an entry whose path passes through a link held inside the agent folder deeper than its own
    name is reported by the guard (not whole) but kept by the supervisor, as round 9's program-level case.
  - NOT CHANGED (nit): a stray link loop on a PATH folder makes the guard not whole (fails safe; the reason names it).
- Round 12 (sonnet): 0 BLOCKER, 4 WARNING, 2 NIT.
  - FIXED: a file to deny that is itself a link (a dotfile kept in another tree) is denied at its own path and where it
    leads, with the folders holding links on the way. Test with a control.
  - FIXED: both tmux config spellings are always named (the board's XDG_CONFIG_HOME need not be the tmux server's).
  - DECIDED: the launch scan is OFF on Windows for now. A standard Windows PATH has folder names the rules read as
    patterns and a system folder past the scan cap, so the guard would never be whole and every token-only agent would
    be refused there. Windows coverage is a later part, measured in the Windows lane (a spec to Homer, not a Mac edit).
    The Windows guard stays exactly what it was. Test pins it. Weakest premise: that no Windows token-only agent relies
    on this part before then.
  - DECIDED, residual: in a source checkout the engine and bin folders are the repository itself, so a token-only
    agent working in the MAIN checkout could not edit them. Worktrees and installs are unaffected, and Kosmos work is
    done in worktrees by rule. Recorded rather than changed.
  - NOT CHANGED (nits): the wiring checks read the supervisor's source (recorded before); a "too long" result cached
    deep and reused shallow only reports more.
- Round 13 (opus): 0 BLOCKER, 2 WARNING, 5 NIT.
  - FIXED: a program or link that leads straight into a SHARED folder (the temp roots, the home folder, Desktop,
    Documents, Downloads, the Kosmos data root) no longer denies that folder whole; the guard says it is not whole
    instead. A dangling link's target is denied as a file at the exact name, not its whole folder. Tests with controls;
    mutations fail. (Before this a stray link could deny an agent its temp folder for good, since deny lists merge.)
  - FIXED: the launch-secrets folder the pane entry reads names from is covered (passed by the supervisor in the same
    spelling it writes; a test pins that the two spellings stay together).
  - FIXED (nits): a file rule the rules cannot carry is reported (test); a throw in the scan writes the rest of the
    guard (test); a bare program name's "." is skipped (test).
  - NOT CHANGED (nits): an alias for folders reached through an ancestor-held link (/tmp to /private/tmp) is not
    written; the resolved spelling is, and the ancestor residual covers the rest. Linux /usr/bin near the scan cap is
    not measured (Linux is not a shipped platform for token-only agents today).
- Round 14 (sonnet): 0 BLOCKER, 3 WARNING, 4 NIT.
  - FIXED: a file to deny whose final name is a link (a dotfiles-style tmux config in the home folder) no longer makes
    the guard not whole: the link and its target are denied by name, so the folder holding the final link is not
    needed. Test with a control; mutation fails.
  - FIXED: the shared-folder rule works by containment. A program's folder that IS or HOLDS a shared folder is said,
    not denied whole; a folder holding a link that contains a shared one (/ holds /tmp) is the ancestor residual,
    skipped. Tests; mutations fail.
  - DECIDED, the cost of the card (recorded so it is not mistaken for a bug): a token-only agent cannot install into
    the launch folders itself (brew install, npm -g, cargo install, pipx and the like), cannot update claude from its
    own shell, and cannot write launchd jobs. That is the point of the guard: what its next start runs is the
    person's and Kosmos's to change, not the agent's. Kosmos's own installs and updates run in the board, outside the
    agent's sandbox. Weakest premise: that no token-only agent's ordinary work needs a global install; if one does,
    the person installs it.
  - NOT CHANGED (nits): the install's engine folder is scanned like a PATH folder (797 entries against a 4000 cap;
    passing the cap fails safe and names the folder); "/" as a PATH entry is dropped by the ancestor check (a test pins
    it); the first test reads the host's real fixed folders for its rules (recorded in round 11).
- Round 15 (opus): 0 BLOCKER, 2 WARNING, 1 NIT. Both warnings were fail-open gaps in round 14's own exemptions.
  - FIXED: every link on the way is recorded with its folder. Where that folder is NOT denied whole (above the agent
    folder, is or holds a shared folder, or a dotfile's own folder), the link is denied by its own name instead, to
    the file tools only. A second link beside a dotfile's (a linked dotfiles folder) is now covered. Test; mutation fails.
  - FIXED: a folder holding a link that holds a shared folder but is NOT above the agent folder is said, not silently
    skipped (the default data root sits in Library, Application Support). Test with a control; mutations fail.
  - DECIDED: a link named by itself goes to the file tools only. How the sandbox matches a link's own path is not
    measured, and resolving it there could deny a whole shared folder. And because the rules read a path as gitignore
    does (a name covers everything under it), a link that is or holds a shared folder, or is in or above the agent
    folder (the system links /tmp, /var, /etc), is never named: above the agent that stays the ancestor residual; a
    dotfile's link that cannot be named is said. Measured here: the real PATH names no link at all.
  - FIXED: each shared folder is matched in every spelling, including with only its parent resolved (as /tmp is a
    link). Test; mutation fails.
  - FIXED (nit): the header's list of what makes the guard not whole is brought up to date.
- Round 16 (sonnet): 0 BLOCKER, 2 WARNING, 3 NIT. Both warnings were over-denial by folder: a folder that only holds a
  link on the way (~/.local when ~/.local/bin is a link) and the real folder of a dev-linked program (a project) were
  denied whole for every token-only agent, for good (deny lists merge).
  - DECIDED and FIXED (one model replaces the folder rules of rounds 7, 9, 14 and 15): a folder is denied whole only
    when its contents run by name (PATH folders, the folders of what the supervisor starts by path, the launchd and
    launch-secrets folders). A program's own FILE where its chain ends is denied by name, in both layers. A LINK TO A
    FILE on the chain is named, to the file tools only. A LINK TO A FOLDER on the way gets no rule: a rule on it would
    cover everything it leads to (gitignore matching), the file tools cannot replace a link, and the sandboxed shell
    writes only in the agent folder and the temp folders. So such a link held inside the agent folder makes the guard
    not whole (as before), one held in a temp folder is said, and elsewhere nothing is needed.
    Weakest premise: that the sandboxed shell cannot write outside the agent folder and the temp folders. The guard
    writes no allowWrite and removes additionalDirectories (#4491), so that is Claude Code's default scope; if a later
    Claude Code widened it, a folder link held elsewhere would need covering again.
    Measured on the real PATH here: whole, 19 folders, 492 program files, 57 file links, 49 ms. Tests rewritten to the
    model; each part has a mutation that fails.
  - Cost noted: about 550 rules instead of about 150, and the accumulation follow-up (versioned paths after upgrades)
    now concerns file paths. Still only over-denial of stale paths.
  - NOT CHANGED (nits): create-time judges the board's own PATH while launch judges the pane's (launch only adds
    coverage; recorded); the extracted shell function runs without set -u in the test (checked by hand); the
    `[ "$RUNNER" = claude ] &&` line relies on there being no set -e (true today).
- Round 17 (opus): 0 BLOCKER, 2 WARNING, 4 NIT.
  - FIXED: a file link on a program's chain held in a temp folder is said (the sandboxed shell could replace it; link
    names reach the file tools only), and still named. Test with a control; mutation fails.
  - FIXED: a file or file link reached through a folder link is also named by the spelling written through that link,
    to the file tools only, as folders are (review 5), so the file-tool rules do not rest on how Claude Code matches a
    linked path. Never a spelling in or above the agent folder, never one with . or .. names. Tests; mutations fail.
  - NOT CHANGED (nits, recorded): a covered item strictly inside a temp folder could be swapped by renaming its holder
    (the temp part of the ancestor residual; whether the sandbox blocks that rename is not measured); programs in a PATH
    folder dropped as shared or the agent's own get no file rule (the guard is not whole there anyway); a dangling
    target later made as a folder would be denied whole (rare, over-denial only); a folder link in an ancestor inside a
    temp folder (not a production layout).
- Round 18 (sonnet): 0 BLOCKER, 3 WARNING, 2 NIT.
  - DECIDED, residual (now named in the header): both layers match by path, so a hard link to a user-owned program
    under another name (in the agent folder) is not covered, as #4491 already says of the token. Closing it means file
    ownership or mode changes, outside this card. Rules are written in the disk's own letter case (as #4491's are).
  - FIXED: tests that a different PATH in the same pass gets its own scan (the cache key), and that a spelling with a
    "." name never becomes a rule. Each fails under its mutation. NOT CHANGED: the one-Map-per-pass line in the refresh
    is performance only (a regression rescans; nothing is under-denied), and the copy of the unsafe list is harmless.
  - MEASURED, not a defect: a PATH handed in through the launch-secrets door would come after the cleaned PATH, but the
    door accepts only names on the engine's token-door allowlist (supervisor, before add_launch_secret), and PATH is not
    one.
- Round 19 (opus): 0 BLOCKER, 3 WARNING, 2 NIT.
  - FIXED: a link that leads to a FOLDER is never named, wherever it sits on a chain (it was named at hop 1 or later,
    and a rule on its name covers everything under it: a PATH folder holding a link to /tmp wrote Edit(//tmp)). It is
    a middle link: no rule, said only where the agent can replace it. Test with a control; mutation fails.
  - FIXED: the programs the supervisor starts by absolute path (claude, tmux, node; KOSMOS_GUARD_RUN_PROGS) have the
    folder their chain ends in denied whole, so a version an update writes into that store mid-session is covered too
    (claude's versions folder). Test with a control; both sides' mutations fail.
  - DECIDED, residual (header and here): any other program repointed by an update (a package manager upgrade) between
    starts is covered from the next start; until then the new target is covered only if it sits in a covered folder.
  - DECIDED, residual carried from #4491 (its review 24 handed it to this card): a soft link the agent makes itself in
    its own folder or in temp, then uses with the file tools. The sandbox layer matches resolved paths and is
    unaffected; the file-tool layer rests on Claude Code resolving links before it matches. Not measured here. The
    review-17 comment was softened to say so.
  - FIXED (nits): a piece of the supervisor's lists that is not a full path (a ":" in a folder name) is said, not
    dropped; the shell test runs the function under set -u with every pattern character. Mutation fails.
- Round 20 (sonnet): 0 BLOCKER, 2 WARNING, 4 NIT.
  - FIXED: a launch with no sender token skips the cleaned pane PATH and the launch-time refresh (they live in the token
    branch, as #4491's refresh did). It is now said in the log, so a listed agent is not launched on the board's last
    guard in silence. Pinned by a source check.
  - FIXED: the first test asserted the guard whole while reading the host's real folders; the wholeness is now asserted
    on a pinned call, and the real fixed list is checked for its rules only.
  - FIXED (nits): the launch-secrets folder is passed only when there is a base (never a bare /launch-secrets; the
    spelling is evaluated in the test); a link held in the agent's own folder is said with its reason.
  - NOT CHANGED (nits): KOSMOS_GUARD_PANE_PATH also reaches the guard for runners that get no cleaned PATH (those
    return "unsupported" today); the walk memo caches a "too long" result (only reports more).
- Round 21 (opus): 0 BLOCKER, 3 WARNING, 1 CONVENTION, 4 NIT.
  - FIXED: a program file whose NAME has a character the rules cannot carry (Homebrew coreutils ships "g[" in a fixed
    folder) made the guard never whole on any Mac with it, refusing every token-only creation. Its folder is now denied
    whole instead, when that folder can be named and is not shared or the agent's; its other spelling likewise, only
    when the real folder was denied. Tests with controls; four mutations fail.
  - FIXED: boardkeychain-4491.test.js pins the launch part of the guard, so its "whole" assertions do not read this
    host's PATH, fixed folders or install.
  - FIXED (convention): the plan's summary describes the current model.
  - DECIDED, residual: a whole PATH entry the guard declines to deny (a shared folder, or one reached through a folder
    link in temp) stays on the pane PATH and is said in the log; the supervisor drops only what it can judge itself
    (the agent folder, above it, not made yet, pattern names, dot names). Closing it means the guard handing the
    supervisor a drop list, rejected in round 9 (it reorders the launch).
  - FIXED (nits): a comment said "shared" for "temp"; the run-programs loop says why a bad link there is quiet. NOT
    CHANGED: the no-token log line names every agent whose mint failed (its wording says "if it is listed").
- Round 22 (sonnet): 0 BLOCKER, 2 WARNING, 3 NIT. The reviewer ran 49 mutations on a copy; each turned a test red.
  - FIXED: every PATH entry the supervisor leaves out of the pane is said in that launch's log, with why (so a tool the
    agent cannot find has a trace). DECIDED: a folder not made yet stays off the pane's PATH until the next start,
    which is when the guard can cover it; said in the log line.
  - FIXED: a PATH folder that exists but cannot be listed is left out of the pane (and said), so the launch-time guard
    is not made never whole by it. The board's own PATH at create time is held as before (an unlistable entry there
    still refuses creation, said with the folder).
  - FIXED (nits): repeated slashes are folded before the checks ("///" is "/"); the blank line between the #4491 doc
    comment and its function is gone. NOT CHANGED: a bare program name is said for RUN_PROGS but skipped for RUN_DIRS
    (not reachable with the plist's absolute paths).
  - Each fix has a mutation that fails.
- Round 23 (opus): 0 BLOCKER, 2 WARNING, 2 NIT. One warning, measured, was a BLOCKER in practice:
  - MEASURED with sandbox-exec on this Mac: a sandbox profile past 65,535 bytes of data is refused ("data object length
    ... exceeds maximum"): 5,000 file paths failed every command; 500 added about 38 ms to each (11 ms with none).
    Deny lists merge and never shrink, so per-program file paths in the sandbox layer would grow with each upgrade until
    every shell command the agent runs failed.
  - FIXED: a program's own file is named to the FILE TOOLS ONLY. The sandbox layer keeps the folders denied whole and
    the few files the start reads. That rests on the premise already recorded (round 16): the sandboxed shell writes
    only in the agent folder and the temp folders; so a program that ends in a temp folder is said. Measured on the
    real PATH here: 23 sandbox entries, 930 bytes; 552 names to the file tools; whole. Tests: the sandbox layer stays
    free of program files for 300 versioned packages; a program in temp is said; two mutations fail.
  - DECIDED, a later part (header and here): what a file the start reads can pull in or run in turn (tmux includes,
    run-shell and plugins; config other started programs read, such as git's). Same class as the Claude-config part.
  - NOT CHANGED (nits): a file LINK at hop 1 or later whose own name has a pattern character is said, not given the
    folder fallback (rare; fails safe); a failure of the token-only probe in the supervisor skips the launch-time
    refresh without a line (the board's last guard stands).
- Round 24 (sonnet): CONVERGED. 0 BLOCKER, 1 WARNING (not new: the accumulation follow-up), 2 NIT (recorded before).
  - Folded into the follow-up: deny lists only grow, so the follow-up card must bound the SANDBOX layer too, not just
    the file tools: about 100 bytes per versioned PATH folder, against the measured 64 KB profile limit (roughly 600
    folders away today). A cheap first step is to say "not whole" or log when the merged list nears a threshold.
- Converged at round 24. Next: when #5122 merges, rebase onto main, then Mortals, the proof and the PR (class-only text).
