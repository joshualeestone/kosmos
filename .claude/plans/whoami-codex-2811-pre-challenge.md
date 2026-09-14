---
method: challenge-loop
branch: whoami-codex-2811
diff_hash: 00f23ede13256ee0b6a336e1a9a634fbd140855993ae3a27972ad5885c95383f
---

# Challenge loop proof, kosmos#2811

39 rounds of blind adversarial review, each by a fresh agent with no prior context. The full
round-by-round record, with the mutant that kills each assertion, is in
`.claude/plans/whoami-codex-2811-plan.md`.

### Final Ledger

**Round 39 (termination check): NO NEW ISSUES.** The reviewer was asked "is there anything that
should block a PR", not "find something". It drove: rename safety (no stranded callers either
side); the #2413 OpenAI badge overlay, ruled out by DATING two facts (`git log -S"args[8]"`
returns exactly one commit, which is also the first to introduce codex to that file, so a codex
agent with a legacy 8-arg plist cannot exist); the `-m` widening against a LIVE `ps` sweep (21
claude-first-token processes, 0 with a standalone `-m`; control: the same regex finds 8 elsewhere
that do); the rendered account picker in Chromium with a mutation control; all six sentence
branches including a 2-arg legacy call; and the four web readers of `runner`.

**Round 38: nothing a user would experience as wrong.** Six user-facing surfaces measured, one
rendered. Two near-findings chased and CLEARED as pre-existing on main rather than counted.

**What the loop actually found.** The product fix has been unchanged and green since round 1.
Rounds 2-28 found defects in the author's DESCRIPTIONS. Rounds 29-38 found defects at readers the
change reached, and in the guards around it:

- `[MAJOR]` r30: the provider gate is global, so a default-account codex agent reached the detail
  panel as `null` and was told "we cannot tell which account this one uses" - a sentence the
  branch itself declares false for that class. Fixed, plus a browser check that reds when reverted.
- `[MAJOR]` r31: that fix reads `a.runner`, and a PANELESS card carries `runner: null`, so it
  went inert there. Fixed server-side.
- `[MAJOR]` r32: the sibling offline row derived the same fact differently and disagreed; and the
  fill could not DECLINE, claiming 'claude' for agents this Mac has no record of.
- `[MAJOR]` r34: the card's LITERAL complaint string - a NAMED codex account was still told "an
  account we cannot identify" while every other surface called it by name.
- `[MAJOR]` r35-37: three distinct gaps on ONE ternary (key presence, the guard, the read), each
  needing its own mutant.
- `[MAJOR]` r38: the live-beats-record precedence was unpinned, and the mutant that breaks it is
  the refactor this codebase preaches.

### What this proof does NOT cover

**No live Codex process has ever run on this machine** (round 39's sweep: 21 claude, 0 codex). The
darwin `agentUnder` codex arm, the `CODEX_HOME` read and the depth/tie ordering are proven by
FIXTURE ONLY. The first real codex agent on a Mac is the check that matters, and no further review
here substitutes for it.

**The win32 gap is real and deliberately unfixed**: a live Codex agent on Windows still fails
`win32live.byName()`'s ownership join, because that enumerates `claude agents --json` which has
no codex arm. One upstream gap, tracked separately.

### Verification

Post-rebase (52 commits onto main, which had moved 319 files): `SUITE_EXIT=0`, 6622 tests, 6613
pass, 0 fail, 9 skipped, cut guard 0 failures, all three browser-check registration guards green.
