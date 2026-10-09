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
