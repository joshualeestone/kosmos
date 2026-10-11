---
pre_challenge: true
method: challenge-loop
branch: hookscripts-5774
diff_hash: 87965388c85722b3a7be5c44f38274ff01c167a9930c0d98d2c520da08368853
validation: passed
subdir_audit: passed
timestamp: 2026-10-11T04:07:17Z
iterations: 28
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 28 blind reviews, alternating Opus and Sonnet, plus one final-gate red (6j) and one merge with main, each of which reopened the loop.
**Converged:** Yes. First at review 24 (Sonnet, NITs only); the final validation then went red on two #1732 Windows guards; fixed, review 25 (Opus) found two real warnings, fixed; review 26 (Sonnet) found nothing new above NIT; main then moved and conflicted, the merge was resolved by hand, review 27 (Opus) found a real BLOCKER (a script linked into a denied folder from outside), fixed, and review 28 (Sonnet) found nothing new.
**Findings:** every review's findings, fixes, decisions and mutation results are below, one section per review, taken from the plan's "Challenge loop notes" written as each review closed. Each fix was checked with a mutation that turned its test red; mutations that stayed green were sharpened until red, and the notes say which.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 7 WARNINGs (as recorded in the plan)
- [BLOCKER] Review 1 (Opus): 1 BLOCKER, 7 WARNINGs, all real. BLOCKER: a word naming a folder (`cd "$CLAUDE_PROJECT_DIR"`) was denied whole, taking the agent's own folder; existing folders are now never scripts. WARNINGs fixed: an interpreter's script that does not exist yet; unknown variables as the program or script; the commands inside `$(...)` and backticks; NAME=value words; the scan wrapped so a throw names a gap rather than dropping the guard; a plugin manifest's own hook, server and language-server paths; CLAUDE_PLUGIN_DATA known; the settings env read. The npm/make/git route is a stated gap, not fixed here. NITs taken: an interpreter's -e, a path inside a word, `2>&1` no longer starts a new command, a control that nothing is denied without config. A redundant guard (never naming the agent folder or the home) went green under mutation because the folder filter already covers it, so it was removed. Validation found the #5386 guard reading a variable map key as an env copy; built as a literal instead.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 10 WARNINGs (as recorded in the plan)
- [WARNING] Review 2 (Sonnet): 10 WARNINGs. Fixed: a program behind a wrapper or keyword, and a runner's subcommand (both left a not-yet-existing script open); a server's command with no args was shell-split; an unexpanded pattern where a script is named was dropped silently; a plugin folder that is the agent folder (or not a full path) would have been denied whole; an unreadable config read as empty; a data argument in the agent folder was denied (the same class as review 1's BLOCKER, one level down); redirection edge cases (`&>`, `>|`, a line continuation, a here-document, a descriptor before a redirection); the no-config control now makes its own files. Deferred with reason: a Windows tokenizer (the guard does not run on win32). NITs taken: HOME left out when unknown; a non-string env value is unknown. A heredoc mutation stayed green on `cat <<EOF` (a plain argument either way); pinned with `bash <<EOF`.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- [BLOCKER] Review 3 (Opus): 1 BLOCKER, 4 WARNINGs, all real, all fixed. BLOCKER: `[`/`[[` read as a glob made `[ -f x ] && ...` (one of the commonest hook shapes) say not whole, refusing token-only agents. WARNINGs: managed preferences (MDM plists) were not read; runners that take their script after a flag; a not-yet-existing run-position script whose path the rules cannot carry was skipped; a plugin folder linked to the agent folder, or a config home, would be denied whole. NITs taken: per-interpreter inline flags (bash -p is not inline), an unknown flag value with a slash is named, only the global config's servers and helpers are read. A mutation of the quoted-path rule stayed green (the test used an absolute path); pinned with a relative one.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs (as recorded in the plan)
- [WARNING] Review 4 (Sonnet): 5 WARNINGs, all real, all fixed: a relative script after `cd elsewhere` was read from the agent folder (a hole); `find -exec`, `env -S` and `uv run --with` hid the script; a flag value such as `=4096` and a package name were denied as files in the agent folder; an empty config file read as unreadable. NITs taken: a plugin inside the agent folder is named; the plan's wrapper claim now names its list; the performance cost is stated. A mutation of the inline-script cd rule stayed green (the test's cd was inside the inline); pinned with an outer cd.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- [BLOCKER] Review 5 (Opus): 1 BLOCKER, 4 WARNINGs, all real, all fixed. BLOCKER: `FOO="1" python3 hook.py` read the quoted assignment as the program, missing the script (the name must be unquoted, the value may be quoted). WARNINGs: an interpreter's value flag took the script slot (fixed as a class: every plain word after an interpreter counts); the suffixed global config names were not read (one list now, shared with the guard); `bash -ce`; the plan's assignment claim had no quoted test. NITs taken: `${VAR:-default}`, `$PWD`, a line continuation joins the word, find's `{}`. Three mutations stayed green on the first try (a control that could not discriminate, a `--rcfile` flag made redundant by the class fix and removed, a test that supplied PWD itself); each sharpened until red.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- [BLOCKER] Review 6 (Sonnet): 1 BLOCKER, 3 WARNINGs, all real. BLOCKER: a `#` comment with an apostrophe opened a quote that swallowed every later line (and here-document bodies and an unclosed quote did the same); fixed. WARNINGs: `PATH=dir` in front of the program (fixed: the program is looked for there too); unlisted wrappers hid a relative script (fixed as a class: a script extension is code anywhere); npm/make in the agent folder reported whole (now named as not whole). NITs: inline non-shell code read as shell (stated); the stated-gaps line updated; tests for each.

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- [BLOCKER] Review 7 (Opus): 1 BLOCKER, 4 WARNINGs, all real, all fixed. BLOCKER: `uv --directory /x run s.py` (the MCP quickstart shape) skipped the folder as a flag value and missed the script; runners' change-folder flags now move where the command runs. WARNINGs: a folder an interpreter runs as code was silently dropped; script-extension patterns refused ordinary formatter hooks; the folder-runner check failed open after an unknown cd; the plan understated the npx/git cost (servers included, with the remedy now in the refusal). NITs taken: swift. One mutation (an unknown change-folder flag) stayed green because the test checked only that something was named; now it checks the reason.

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- [WARNING] Review 8 (Sonnet): 4 WARNINGs. Fixed: `~` after the = or a : of an assignment (PATH=~/bin) was not the home; bun, deno and uv package scripts were not folder runners; `.command` matched jq filters (`'.tool_input.command'`), so it left the extension list. Decided (a product trade, recorded above for Josh): the npx/git refusal cost. NITs: nesting past the read depth is named, not dropped; JSONC in settings looked for in the binary and not found (Bun's own loaders only), so a file that does not parse stays named. Two mutations stayed green: a colon case the test did not exercise (pinned), and a subcommand list made redundant by the package-script rule (removed).

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- [WARNING] Review 9 (Opus): 3 WARNINGs, all real, all fixed: `processWrapper` (in 2.1.296's own list of command settings) was not read, and the managed `policyHelper` object's path is now read as a program; `$'...'` and `$"..."` quoting made an ordinary `printf $'\n'` hook read as an unclosed quote (not whole); an unlistable managed-settings.d was read as empty. NITs taken: `perl -pe` and the like; a non-shell interpreter's inline code is no longer read as shell (it named nonsense files); `$USER`, `$LOGNAME`, `$TMPDIR` are known; a script inside a plugin folder denied whole gets no rule of its own. Stated: a file piped into a shell, single-file source launches. The plugin-rule mutation first stayed green (only profile size changed); pinned by asserting the duplicate rule is absent.

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- [WARNING] Review 10 (Sonnet): 2 WARNINGs, both real, both fixed: input redirection counted as running for any program (`jq . < state.json` denied the agent its state file); a here-string given to a shell was not read. NITs taken: a word with a space (a sentence ending in `a.py`) is not a script path; a config that does not parse is read once more before it is named. Not taken: a script reached through a link in the middle of a denied folder gets a redundant rule of its own (profile size only). The retry mutation first stayed green (nothing made a read fail once); a test now makes the first read half-written.

#### Iteration 11
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- [BLOCKER] Review 11 (Opus): 1 BLOCKER, 2 WARNINGs, all real, all fixed. BLOCKER: hooks and the status line run in the session's current folder (checked in the binary), so a relative hook script resolved against the agent folder could be bypassed by a cd into a subfolder; now named unless the line anchors itself, and `$PWD` is no longer known. WARNINGs: `CLAUDE_CODE_SHELL_PREFIX` was not read; the launch scan's comment still said this route was open. NITs taken: the module header's not-covered line, `arch`. Not taken: the --settings file Kosmos itself writes (its hook is in the engine folder, already denied). Two mutations stayed green at first (the server and $PWD cases were only tested through the splitter); both now go through the guard.

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- [WARNING] Review 12 (Sonnet): 2 WARNINGs. Fixed: an unknown variable passed as an argument after the script (`node ~/x.js "$FOO"`, `"$@"`) made the guard not whole. Deferred after measuring: skipping the agent's own two settings files. Its premise was that the guard rewrites them so their commands never run; read in the guard, settings.json is merged (every key kept) and cleanLocalSettings keeps every key outside the sandbox block, so both files' hooks run. I briefly accepted the premise for settings.local.json and reverted on reading cleanLocalSettings; a test now pins that its hooks are read. NITs: process substitution (stated); argument files outside the agent folder add rules (the stated safe-direction cost).

#### Iteration 13
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- [BLOCKER] Review 13 (Opus): 1 BLOCKER, 2 WARNINGs, all real, all fixed. BLOCKER: an exec-form hook (`command` with `args`) was anchored to the project folder like a server, reopening review 11's subfolder route one spelling over (the binary spawns it with the session's cwd). Only server keys anchor now. WARNINGs: exec-form words were expanded like a shell's (Claude Code expands only its own variables there); a value flag's value that is a file the program loads (`--env-file`, `ruby -r`, `--import-map`) was skipped while its `=` spelling counted, and a glued `-r/h/x.rb` named nonsense. NITs taken: `bash +x`, a redirection before the program. Stated: a PowerShell hook, env pooled across homes. The redirection mutation first stayed green (a bare file name produces nothing either way); pinned with a path.

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- [WARNING] Review 14 (Sonnet): 2 WARNINGs, both real, both fixed: a plugin's monitors (background scripts, unsandboxed like hooks) were read only when written inline in the manifest, not from `monitors/monitors.json` or a path the manifest (or its `experimental` block) names; a `trap` command line (run later) was read as plain text. NITs: argument files outside the agent folder add rules (the stated cost); trap is now read, so it leaves the gaps list.

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- [WARNING] Review 15 (Opus): 2 WARNINGs, both real, both fixed: a folder runner moved out of the agent folder (by cd or its own flag) was neither denied nor named, and the refusal's advice ("run it from another folder") pointed at exactly that route; a folder in the program position (`uvx --from /dir tool`) was dropped silently. Four earlier assertions said a runner elsewhere was clean; they were wrong and now assert it is named where it runs. NITs taken: project entries read for servers and helpers only; a plugin's .mcp.json and .lsp.json are servers (project folder); the setup-assistant comment says the ancestors' rule is file-tools only. Stated: Linux sandbox program paths.
- [WARNING] Got wrong, caught before review: my first review-15 commit named a folder runner everywhere, and the real-config check then refused every token-only agent on the fleet Mac (the Discord plugin's server runs `bun run --cwd <its own folder> start`). That folder is denied whole, so its code is covered; runners inside folders the guard denies whole are now exempt, pinned by a plugin test, a config-home test and a control.

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- [WARNING] Review 16 (Sonnet): 3 WARNINGs, all real, all fixed: `.command` (a macOS script) was out of the extension list since review 8, now back for a word that is a path (not a jq filter); awk's, sed's and jq's program text is code, and the absolute paths in it count; a runner specifier (`npm:foo`, `jsr:@std/x`) read as a file and refused Deno servers. NITs taken: a config nested past the read limit is named; paths in macOS's sealed system folders (/System, /bin, /usr/bin and the like, not /usr/local) get no rule; the plan's program-word sentence. Got wrong in flight: a batch replace put the new flag's reset on its declaration line (an undeclared assignment); fixed before the tests ran.

#### Iteration 17
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- [WARNING] Review 17 (Opus): 3 WARNINGs, all real. Fixed: a program run from a package folder inside the agent folder, and python -c / node -e run there, were covered by one file's rule while the code they load stayed open (named now, like a folder runner); the common formatter, linter and build hooks were not folder runners (added; the list is stated as partial). Stated: what a denied path costs the agent (its parent folders cannot be made, moved or removed). NITs taken: swift is a folder runner, not an interpreter; `exec -a`; the Linux seccomp paths. Not taken: `function f { ... }` and `coproc` paths are counted as paths but not as run positions (affects only the uncarriable-path rule).

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- [WARNING] Review 18 (Sonnet): 2 WARNINGs. Fixed: `2>&1` (and `>&2`, `<&0`) left its digit as an interpreter argument, denying a file named `1` in the agent folder and, after an unknown cd, refusing an ordinary hook; the descriptor word is now skipped. Decided (narrowed, with its cost stated above): inline python and node. NITs taken: the run test and the script-position test are one now (their drift is how the unknown-cd check used the wider one); each config's commands are read inside their own catch, so one unreadable source is named and the rest still denied. That per-source catch is not pinned by a test: nothing in a parsed config makes the reader throw today, and the test I first wrote for it could not fail, so it was removed.

#### Iteration 19
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- [WARNING] Review 19 (Opus): 3 WARNINGs, all real, all fixed: an assignment value was parsed as a command line, so `TZ=America/Chicago date` and `PYTHONPATH=<dir> python3 x` refused (values now yield only absolute files, never a program); `bash -eo pipefail x.sh` let the option's value take the script slot (clusters ending in o, and family lookup so python3.12 uses python3's table); the package-folder rule reaches beyond the agent folder, now stated, with its own refusal text. NITs taken: managed preferences pinned off in the tests; the settings-env PATH and relative assignment values stated. Got wrong in flight: a `//` comment inserted mid-line commented out four table entries; a test caught it at once.

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- [WARNING] Review 20 (Sonnet): 3 WARNINGs, each a member of a class the plan already names or a cost it already takes; no code change, the plan now says each plainly: a loop over a folder of scripts refuses; a here-document piped into a shell is unread (the piped-input gap widened); a script-extension word in the agent folder denies the agent that file. NIT not taken: a script reached through a link into a denied folder gets a redundant rule (profile size only, review 10).

#### Iteration 21
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- [WARNING] Review 21 (Opus): 2 WARNINGs, both real, both fixed: a command-sourced plugin's `sourceCommand` (re-run once per session) and the marketplaces' commands (known_marketplaces.json, each marketplace.json) were not read, and a plugin served from a producer folder (`sourceProducerPath`, `previousProducerPaths`) was not denied whole; python reading its program from standard input (`python3 -`, `python3 <<EOF`, `python3 < x`) imports from the folder it runs in, like -c. NITs taken: `uv tool run X` is uvx X (it read "tool" as a package script); a flag's value names a script only with a script extension (`--config=ruff.toml` is data); server words expand only `${VAR}` / `${VAR:-x}`; jq's `//` is no path; the stale comment and plan lines about uncarriable paths and processWrapper. Stated: launcher caches. Got wrong in flight: `.filter()` dropped the property holding the source commands; the test caught it. A heredoc mutation first stayed green (the `-` rule covered the test's spelling); pinned without the `-`.

#### Iteration 22
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- [WARNING] Review 22 (Sonnet): 2 WARNINGs, both statements of cost or premise, no code change: a shared log or state file outside the agent folder that a hook touches is denied to the agent; a script above the agent folder rests on the shell's default write scope. NITs: each already stated (uncarriable data paths skipped, inline paths in program text, a file that does not parse twice, the agent's own settings read).

#### Iteration 23
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs (as recorded in the plan)
- [WARNING] Review 23 (Opus): 1 WARNING, real, fixed: a cd that does not last (inside a subshell, backgrounded, undone by popd) left the line anchored, reopening review 11's subfolder route; the plan's "over-counts rather than misses" was true of the folder list but false of the anchoring built on it. The splitter now keeps subshell and background markers, only the line's first command's cd anchors (a later one may be conditional), and popd un-anchors. NITs taken: a PATH= prefix carries into `bash -c`; `bash -s` (its later words are arguments, not the script); `$TMPDIR` unknown; plugins for other projects stated. A subshell-restore mutation first stayed green (the first-command rule covered the test); pinned with a folder runner after a subshell.

#### Iteration 24
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, NITs only
- [NIT] engine/startcommands.js: `python -m json.tool` gives a bogus path (it refuses anyway)
- [NIT] the plan states the `start` cost (a package.json script named everywhere)
- [NIT] the outer catch drops partial results (only on a programming error)
**Converged** - then the final validation (6j) went red; see the next section.

#### Iteration 6j
**Reviewer model:** none (the final validation helper)
**New findings:** 0 BLOCKERs, 0 WARNINGs (as recorded in the plan)
- [WARNING] Final validation (6j) on 5f7d945b2, 17:13: RED on two #1732 Windows-coupling guards (win32-separator-guard, windows-coupling-audit-1732), both for startcommands.js `value.split(':')`. FIXED by classifying it in both guards as a non-path-delimiter use. It parses a PATH= assignment inside a POSIX shell command line, where : is that shell syntax's own separator (Git Bash on Windows included). path.delimiter would be the bug here, because it is the host's separator, not the command line's. Both guard files and discover.scan-1938 pass (31/31). This reopens the loop for iteration 25.

#### Iteration 25
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs (as recorded in the plan)
- [NIT] Review 25 (Opus), after the final-validation fix (9f0d23d35):
- [WARNING] FIXED. A nested line (bash -c, $(...), a here-string) started from the tail of the folder list, with "folder unknown" reset. So `cd "$UNK" && bash -c ./x.sh` read as whole, and `(cd /plug) && bash -c make` placed make in /plug. pathsOfWords now takes the folder its command runs in (cmdCwd or lastCwd) and whether it is known (`whereIn`).
- [WARNING] FIXED. `cd <absolute>; ./x.sh` anchored the line, but `;` runs on after a failed cd, and the agent can make a cd into its own folder fail. shellWords now marks each separator (&&, ||, |, ;), and an absolute cd anchors only when && follows it.
- [NIT] taken: a pipeline stage's cd is its own subshell. `|` now restores the line's folder as a lone & does, and cancels anchoring.
- [NIT] Test "review 25": each of the reviewer's measured lines, plus && controls. Mutations, each red: no folder state into the nested parse; a cd anchoring before ;; a pipeline cd moving the next stage. The last stayed green at first, because the unsafe count alone could not see it (| already cancels anchoring); it was sharpened with `cd /opt && cd /plug | make` placing make in /opt, then red.
- [NIT] Guard set (19 files, plus the two #1732 guards): 885 pass, 0 fail. Real-config check: 11 files, unsafe [], byte-identical to the committed version on the same input.
- [NIT] NITs not taken: `${VAR:-${HOME}/x}` closes at the first } (a wrong extra rule at most, never a missed one); the unreachable last branch of wordsOf; the bare-cd/absolute-cd headsSeen asymmetry (both are correct).

#### Iteration 26
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs above what earlier reviews settled
- [WARNING] engine/startcommands.js readJsonFile: an empty file reads as no settings --> DUPLICATE of review 4 (decided, in the plan)
- [WARNING] engine/startcommands.js readJsonFile: ENOTDIR reads as missing --> NOT A DEFECT: a parent that is a file means the config cannot exist, so Claude Code cannot read it either
- [CONVENTION] the module is pinned to Claude Code 2.1.296 --> DUPLICATE: a stated gap in the plan
- [CONVENTION] the file is large --> style, not changed
- [NIT] engine/startcommands.js: an unused TMPDIR line; an identity helper
**Converged** - then main moved and #5814 conflicted; see the merge section.

#### Iteration merge
**Reviewer model:** none (a merge with main, resolved by hand)
**New findings:** 0 BLOCKERs, 0 WARNINGs (as recorded in the plan)
- [WARNING] Merged main at 495061fe8 (#5814 conflicted). engine/setup-assistant.js keeps both sides: main's launchSecretDirs and trustedFiles, and this branch's commandScripts, in the return object and in both layers. The guard set passed (889, 0 fail).

#### Iteration 27
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs (as recorded in the plan)
- [NIT] Review 27 (Opus), on the merged tree:
- [BLOCKER] FIXED. A script inside a folder the guard denies whole, but linked to a file outside it, was skipped as covered, so its real target got no rule, and the guard said whole. The reviewer measured it (a hook kept in a dotfiles repo and linked into ~/.claude/hooks, a common setup). It is covered now only when its real target sits inside a whole-denied folder too, comparing real paths on both sides; otherwise withTarget gives it rules in both layers. The same for a plugin folder. Same class, also fixed: a folder runner (make) in a folder linked into a covered one from outside was treated as covered; its real folder is now checked, and the covered folders carry their real paths (/var against /private/var). Test "review 27" with controls (a plain script in hooks/ keeps only the folder's rule; make in a plain folder there is covered). Three mutations, each red.
- [WARNING] DECIDED, not changed: plutil per guard pass. It runs only when a managed-preferences plist exists (a stat first), and none exists on this fleet. On an MDM-managed Mac, reading the plist is the point.
- [NIT] not taken: ancestor folders (file-tools-only) share the covered list. The comment states it, and the new real-path check applies to them too.

#### Iteration 28
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs above what earlier reviews settled
- [WARNING] engine/startcommands.js: the unused TMPDIR line and its comment --> DUPLICATE of review 26 (NIT, not taken; the effect is the safe direction: $TMPDIR reads as unknown)
- [NIT] the identity helper; pathsOfWords takes nine positional parameters; a comment on config homes covered through pluginDirs
**Converged** - no new actionable findings.

### Strengths (across all iterations)
- Unknowns are named, never dropped: a variable it cannot read, an unclosed quote, a folder it cannot follow, depth past three, an unreadable config (reviews 25, 26)
- The real-config check (read-only, on this fleet's own settings) was run after every change and stayed at unsafe [] (every review)
- Every fix has a test that a mutation turns red (every review)
