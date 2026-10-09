# launchprune-5663: the token-only guard prunes launch rules of removed tool versions, and says when its deny paths pass a measured sandbox ceiling (kosmos#5663)

## Finished looks like
An agent launch after an upgrade leaves no rule for a removed version folder or file that was recorded (every launch rule written from this change on), in either layer. The person's own rules and the rest of the guard are untouched. A guard whose denied paths would pass a measured sandbox ceiling says so as a warning.

## Built (current, after reviews 1 and 2)
- engine/setup-assistant.js:
  - A record of the launch rules the guard wrote, at `.claude/kosmos-launch-rules.json`. It is denied to the file tools, and the sandbox denies its folder. The record is a union: what was recorded and not pruned, plus what is current.
  - Pruning is done only by an agent launch, which is the refresh that carries the pane PATH. It drops a recorded launch entry that is not current AND whose path is gone from disk. This happens in both layers. Every other rule merges as before.
  - The ceiling, macOS only, counts every path that reaches the sandbox profile: both sandbox lists, plus the targets of the Edit and Read deny rules, each counted once. Past 40 KB of distinct prefixes or 160 KB raw, the guard is written and whole, and it returns a `warning` (also written to stderr), never a refusal. The warning is given beside an uncovered-PATH reason, not instead of it.
- engine/launchprune-5663.test.js.

## Decided
- No record (a guard written before this) prunes nothing; the record starts at the next refresh. Launch rules themselves arrived with #5516 part 1 (#5660, merged 2026-10-09 03:03), so the only unrecorded launch rules are those written by a board running main between that merge and this one. No migration (review 5): a guess at which old rules were launch-shaped could drop a rule the guard did not write, and the leftover is bounded to one version per tool.
- A rule the person also wrote that equals one the guard wrote for launch is pruned with it when its path is gone. Accepted: such a rule names a path that no longer exists.
- The record is read and written without a lock. Two refreshes at once can lose a recorded entry. That entry is then never pruned: kept, not dropped. Accepted, because the failure direction is safe.
- Pruning assumes every launch passes the same launch inputs (the supervisor always does). A launch rule for a path that is deliberately denied while absent stays current at every launch, so it is not pruned.
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
