# launchprune-5663: the token-only guard prunes launch rules of removed tool versions, and says when its deny paths pass a measured sandbox ceiling (kosmos#5663)

## Finished looks like
An agent launch after an upgrade leaves no rule for the removed version folder, in either layer. The person's own rules and the rest of the guard are untouched. A guard whose denied paths would pass a measured sandbox ceiling says it is not whole.

## Built (current, after reviews 1 and 2)
- engine/setup-assistant.js:
  - A record of the launch rules the guard wrote, at `.claude/kosmos-launch-rules.json`. It is denied to the file tools, and the sandbox denies its folder. The record is a union: what was recorded and not pruned, plus what is current.
  - Pruning is done only by an agent launch, which is the refresh that carries the pane PATH. It drops a recorded launch entry that is not current AND whose path and parent folder are both gone from disk. This happens in both layers. Every other rule merges as before.
  - The ceiling, macOS only, counts every path that reaches the sandbox profile: both sandbox lists, plus the targets of the Edit and Read deny rules, each counted once. Past 40 KB of distinct prefixes or 160 KB raw, the guard is written and says it is not whole. That reason is given beside an uncovered-PATH reason, not instead of it.
- engine/launchprune-5663.test.js.

## Decided
- No record (a guard written before this) prunes nothing; the record starts at the next refresh.
- A rule the person also wrote that equals one the guard wrote for launch is pruned with it when its path is gone. Accepted: such a rule names a path that no longer exists.
- The record is read and written without a lock. Two refreshes at once can lose a recorded entry. That entry is then never pruned: kept, not dropped. Accepted, because the failure direction is safe.
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
