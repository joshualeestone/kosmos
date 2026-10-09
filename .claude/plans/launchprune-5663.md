# launchprune-5663: the token-only guard replaces its launch rules, and its sandbox layer has a ceiling (kosmos#5663)

## Finished looks like
A refresh after an upgrade leaves no stale launch rule in either layer, the person's own rules and the rest of the
guard untouched; a guard whose sandbox layer would pass a measured ceiling says it is not whole.

## Built
- engine/setup-assistant.js: a record of the launch rules each refresh wrote (`.claude/kosmos-launch-rules.json`,
  denied to the file tools; the sandbox already denies that folder). Each refresh drops last time's launch rules that
  are not launch rules now, in both layers; every other rule merges as before. SANDBOX_DENY_BYTES_MAX (48 KB, counted
  as each denyRead and denyWrite path plus 40 bytes): past it the guard is written and says it is not whole.
- engine/launchprune-5663.test.js.

## Decided
- No record (a guard written before this) prunes nothing; the record starts at the next refresh.
- A rule the person also wrote that equals one the guard wrote for launch is pruned with it when it stops being a
  launch rule. Accepted: the guard's own rules are Kosmos's; the person's are untouched otherwise.
- The ceiling is under the measured sandbox-exec limit (65,535 bytes of profile data); how Claude Code builds its
  profile is not measured, so the margin is wide. Weakest premise: the 40-byte per-rule overhead.

## Review 1 (Opus) and what changed

- BLOCKER, fixed: pruning was caller-dependent. A board start has no pane PATH, so "not a launch rule now" would prune what a launch wrote. A recorded entry is now pruned only when it is not current AND neither its path nor its parent folder exists (an upgraded tool's removed version folder); a path that cannot be read is kept. The record is a union (recorded and not pruned, plus current), so no caller erases another's entries, and a scan that finds nothing prunes nothing.
- The ceiling, re-measured (claude -p with the sandbox on): Claude Code puts the Edit and Read deny rules into the sandbox profile too (a shell write to an Edit-denied file was refused). Two limits stop every sandboxed command:
  - sandbox-exec's 65,535-byte compiled profile. Compiled size follows distinct path prefixes, not raw bytes: every set that ran had at most 34,216 distinct prefix characters (4,312 paths from this machine's real PATH: 33,636), every set that failed had at least 51,816;
  - E2BIG on the command line that carries the profile: 248,670 raw bytes failed, 223,734 ran.
  The guard now counts every path that reaches the profile (both sandbox lists and the Edit/Read rule targets, each once) and says it is not whole past 40 KB of distinct prefixes or 160 KB raw. This machine's real guard today: 602 paths, 7,379 distinct, 33,817 raw.
- Weakest premise: the prefix model is fitted to eight measured sets. The compiler's real cost could differ for path shapes I did not try (many short unrelated paths cost the most per byte, and that is what the synthetic sets were). What would change it: a set under 40 KB distinct that fails.
- Tests added: a board-start refresh keeps what a launch wrote (record included), and prunes once the folder is gone; a path still on disk, or whose parent is, is kept; a corrupt or wrong-shaped record prunes nothing; each limit pinned at its exact boundary through the guard, with a control that the raw arm alone turned it.
- Nits taken: a temp record left on a failed rename is removed. Not taken: comparing records by resolved path (the record stores what the guard wrote, already resolved).
