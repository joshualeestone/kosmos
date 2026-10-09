# launchprune-5663: the token-only guard prunes launch rules of removed tool versions, and says when its deny paths pass a measured sandbox ceiling (kosmos#5663)

## Finished looks like
An agent launch after an upgrade leaves no rule for a removed version folder or file that was recorded (every launch rule written from this change on), in either layer. The person's own rules and the rest of the guard are untouched. A guard whose denied paths would pass a measured sandbox ceiling says so as a warning.

## Built (current)
- engine/setup-assistant.js:
  - A record of the launch rules the guard wrote at an agent's launch, at `.claude/kosmos-launch-rules.json`. It is denied to the file tools, and the sandbox denies its folder. The record is a union: what was recorded and not pruned, plus what this launch wrote and that exists on disk. A board start never adds to it.
  - Pruning is done only by an agent launch, which is the refresh that carries the pane PATH. It drops a recorded launch entry that is not current AND whose path is gone from disk. This happens in both layers. Every other rule merges as before.
  - The ceiling, macOS only, counts the paths THIS AGENT'S settings file sends to the sandbox profile, per clause: the read clause is denyRead plus the Read targets; the write clause is denyWrite plus the Edit targets. Rule targets are taken in the guard's `//abs` spelling and the person's `~/` one. The person's user-level settings files also reach the profile and are not counted (#5668). Past 40 KB of distinct prefixes or 160 KB raw, the guard is written and whole, and it returns a `warning` (also written to stderr), never a refusal. The warning is given beside an uncovered-PATH reason, not instead of it.
- engine/launchprune-5663.test.js.

## Decided
- No record (a guard written before this) prunes nothing; the record starts at the next refresh. Launch rules themselves arrived with #5516 part 1 (#5660, merged 2026-10-09 03:03), so the only unrecorded launch rules are those written by a board running main between that merge and this one. No migration (review 5): a guess at which old rules were launch-shaped could drop a rule the guard did not write, and the leftover is bounded to one version per tool.
- A rule the person also wrote that equals one the guard wrote for launch is pruned with it when its path is gone. Accepted: such a rule names a path that no longer exists.
- The record is read and written without a lock. Two refreshes at once can lose a recorded entry. That entry is then never pruned: kept, not dropped. Accepted, because the failure direction is safe.
- Only a launch records, so a launch prunes only what a launch wrote. A board start's launch rules come from its own inputs (its PATH, its XDG_CONFIG_HOME), are never recorded, and so are never pruned. Launch inputs are NOT stable: the pane PATH is the tmux server's global PATH (review 9). So the record holds only paths that existed when they were recorded. A path denied while absent on purpose is never recorded, and is never pruned, whichever launch drops it.
- Plan file name: the PR hook requires `.claude/plans/<branch>.md`. CLAUDE.md's timestamped name is not used here, as on every kosmos branch.

## Review 1 (Opus) and what changed

- BLOCKER, fixed: pruning was caller-dependent. A board start has no pane PATH, so "not a launch rule now" would prune what a launch wrote. A recorded entry is now pruned only when it is not current AND neither its path nor its parent folder exists (an upgraded tool's removed version folder); a path that cannot be read is kept. The record is a union (recorded and not pruned, plus current), so no caller erases another's entries, and a scan that finds nothing prunes nothing.
- The ceiling, re-measured (claude -p with the sandbox on): Claude Code puts the Edit and Read deny rules into the sandbox profile too (a shell write to an Edit-denied file was refused). Two limits stop every sandboxed command:
  - sandbox-exec's 65,535-byte compiled profile. Compiled size follows distinct path prefixes, not raw bytes: every set that ran had at most 34,216 distinct prefix characters (4,312 paths from this machine's real PATH: 33,636), every set that failed had at least 51,816;
  - E2BIG on the command line that carries the profile: 248,670 raw bytes failed, 223,734 ran.
  The guard now counts every path that reaches the profile (both sandbox lists and the Edit/Read rule targets, each once) and says it is not whole past 40 KB of distinct prefixes or 160 KB raw. This machine's real guard today: 602 paths, 7,379 distinct, 33,817 raw.
- Weakest premise: the prefix model is fitted to eight measured sets. The compiler's real cost could differ for path shapes I did not try (many short unrelated paths cost the most per byte, and that is what the synthetic sets were). What would change it: a set under 40 KB distinct that fails.
- Tests added: a board-start refresh keeps what a launch wrote (record included), and prunes once the folder is gone; a path still on disk, or whose parent is, is kept; a corrupt or wrong-shaped record prunes nothing; each limit pinned at its exact boundary through the guard, with a control that the raw arm alone turned it.
- Nits taken: a temp record left on a failed rename is removed. Not taken: comparing records by resolved path (the record stores what the guard wrote, already resolved).

## Review 2 (Sonnet) and what changed

- Two test assertions were vacuous: the expected sandbox path was computed after the folder was deleted, so realOr fell back to the unresolved spelling. Expected values are now taken before deletion, with a control that they were present. The upgrade test also asserts that no spelling of the old folder is left.
- A folder that is only gone for now (an unmounted volume) would have been pruned by a board start. Now only an agent launch prunes. A folder the launching agent runs from is on its PATH, so it is current and kept.
- The ceiling ran off macOS on a sandbox block already in the file. It is now macOS only, and its reason is given beside an uncovered-PATH reason.
- The comment on the record no longer claims what the lock-free write cannot promise (see Decided).
- The #5663 block was moved above the doc comment it had split from its function.

## Review 3 (Opus) and what changed

- Review 2's block move put the #5663 code above `'use strict'`, which turned the whole module into sloppy mode silently. The code is moved back above the token-only doc comment, and `'use strict'` is line 1 again. Class guard: `engine/use-strict-first-5663.test.js`. Every tracked .js file that says 'use strict' must say it first (1,902 files; all pass), with a control that the check sees a misplaced directive. Proven red by prepending a statement to setup-assistant.js.
- A version kept as one file in a folder that stays (`versions/<n>`) was never pruned, because the parent always existed. Now that only a launch prunes, the parent-folder condition protected nothing the launch gate does not, so it is dropped: a path that is not current and is gone is pruned. A test covers that layout.
- Nits taken: the size-limit comment now sits on its check; a record rule that cannot be written is said on stderr; the current launch writes are a Set.

## Review 4 (Sonnet) and what changed

- The size ceiling returned `ok:false`, and agent creation refuses on `ok:false`. So an estimate fitted to eight measurements could stop a person creating a token-only agent. The guard is whole either way (the token is denied); the risk is that the shell may not run. It is now `ok:true` with a `warning`, written to stderr as well. Decided: a warning, not a refusal. What would change it: a measured profile under the limits that still fails.
- A record rule that cannot be written (a pattern character in the agent's folder path) now marks the guard not whole, as reviews 16 and 17 rule for any dropped self-protection rule. It is not separately testable: the same folder path already drops the guard's other rules.
- The use-strict guard now also sees a double-quoted directive, and one with no semicolon.
- Not taken: `ruleTarget` counts a `.*` tmp glob as literal characters. That over-counts slightly, in the safe direction.

## Review 5 (Opus) and what changed

- The ceiling now counts per clause: the read clause is denyRead plus the Read targets; the write clause is denyWrite plus the Edit targets. A path in both is paid for twice. Every measured set was one clause, so this counts at least what was measured. Real guard here: 616 paths, 7,706 distinct, 36,007 raw.
- Legacy rules: the claim is bounded to recorded rules, with no migration (see Decided).
- A test drives the launch through KOSMOS_GUARD_PANE_PATH, as the supervisor does, so a rename of that variable reds.
- The use-strict guard sees a directive with a trailing comment.
- The comment says that a dangling link counts as present (kept).
- Not taken: carrying the warning into the board's page. It is on stderr, as decided in review 4.

## Review 6 (Sonnet) and what changed

- The pruning comment no longer claims the person's own rules are untouched: a rule of theirs that is the same string as a pruned launch rule goes with it. It names a path that no longer exists.
- The record's temp file name is unique per write, so two refreshes in one process cannot share it.
- The warning's readers are stated in the doc comment: the board's and the supervisor's logs. No caller carries it further (decided in review 4, raised again in reviews 5 and 6).
- Not taken: a directive written inline after code on one line (`x; 'use strict';`). The guard covers the class review 3 found, a block inserted above the directive.

## Review 7 (Opus) and what changed

- BLOCKER-class (raised as a WARNING), fixed: a board start recorded launch rules built from the board's own inputs. Some of those deliberately name absent paths, because what is later made there would run, such as an XDG tmux.conf or an absent folder on the board's PATH. The next launch, whose inputs need not include them, saw those rules as not current and gone, and pruned them. That uncovered such a path for the whole session. Now only a launch adds to the record. Test: a board-only absent folder survives two launches. Both mutations (recording board-start entries in either layer) go red.
- The record is written before the local-settings clean, so a throw there cannot leave this refresh's rules unrecorded.
- Not taken: settings.json's own temp name (`<pid>.new`) is unchanged. It is existing code from #4491 review 24, not this card.
- Not taken: the use-strict detector anchors on an unindented directive line, so a function-level (indented) one is not flagged. An unindented directive line inside a template literal would be a false red; none exists.

## Review 8 (Sonnet) and what changed

- A launch whose pane PATH is empty, or has no absolute entry, counted as a launch's inputs and could prune. Now a launch prunes only when its PATH has at least one absolute entry. Test: an empty, a bare-delimiter and a relative-only PATH prune nothing, with a control that a real PATH does. The old gate goes red.
- `crypto` is required with the module's other requires. The ceilings are labeled as fitted, not derived.
- Decided, not changed:
  - **Upgrade window.** A path absent only for a moment at the launch, such as an in-place version swap, is pruned. If it comes back on that launch's PATH it is current at the next launch and is written again. If it does not, the agent does not start from it. The exposure is one session for a path recreated mid-session and not on the launching PATH.
  - **The size warning repeats in the board log at every board start** for an agent over the ceiling. That is acceptable for a state that blocks the agent's shell.
  - **No "Where to Find Things" row.** No files, commands or directories moved, and the token-only guard has no row today.
  - **The use-strict guard stays in this PR.** It guards the defect this branch introduced and fixed (review 3). Its known false-red shape is named in the test header.

## Review 9 (Opus) and what changed

- The absent-on-purpose class from review 7 reached launch inputs too. The pane PATH is the tmux server's global PATH, so a folder like a tool's bin before it is installed could be on one launch's PATH and not the next. It would then be pruned, a program planted there during that session, and the program would run at the following launch. Now only a path that exists at record time is recorded. A removed version existed when it was recorded, so the upgrade case still prunes. Test: an absent launch folder is not recorded and survives a launch without it. Both mutations go red.
- The plan's premise sentence is replaced: launch inputs are not stable.
- Not changed: the record's Edit rule uses the agent folder's unresolved spelling, like the existing settings-file Edit rules. The sandbox's whole-folder deny on `.claude` is what protects it in every spelling.

## Review 10 (Sonnet) and what changed

- A record that does not parse was read as none and then overwritten, so everything it named was forgotten. Now a dated copy is kept beside it first, and the log says so, as the settings file does (#4491 review 18). Test: a dated copy holds the bad text, with a control that a parseable record is not copied. Removing the copy goes red.
- The warning reaching only the logs (raised in reviews 4, 5, 6 and 10) is now its own card, #5668.
- Duplicates of decided points: a person's identical rule string; a path recreated mid-session (review 8); existing unrecorded rules (review 5); the lock-free record.
- Not taken:
  - The use-strict guard's dependence on `git ls-files`. Every test here runs from a checkout.
  - The ceiling test's 1,400 folders. It is the through-the-guard arm, and its boundary twin is the synthetic one.
  - Review-number comments. That is the file's style.

## Review 11 (Opus) and what changed

- The size claim is narrowed to what is counted: this agent's settings file. The person's `~/` rule spelling is now counted against home. User-level settings files are not counted, because which one an agent reads is its account's. #5668 carries that, with a comment.
- A record that exists but cannot be read (EACCES, EISDIR, EIO) was treated as none and then overwritten. Now only ENOENT means none yet. Any other error is logged, nothing is pruned, and the record is left as it is. Test: a mode-000 record keeps its rule, and the file is unchanged; both mutations go red.
- An unparseable record gets one dated copy per content, not one at every refresh.
- The doc comment states the `warning` field. The plan's Built heading says current.
- Not taken: parsing the first statement for the use-strict guard. Its false-red shape is named in its header, and none exists.
