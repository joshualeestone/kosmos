---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: paneless-roster-1112
diff_hash: da04067902df9b5aedf7f6abf1507a17992fbb8e447d34d466e3eb7c03d1d22f
subdir_audit: passed
timestamp: 2026-08-28T03:01:26Z
---

## [PRE-CHALLENGE] Self-Check Results

Single-pass, explicitly chosen over `/challenge-loop` by the operator (Splinter,
2026-08-27 21:58 CDT). His reasoning, recorded because it changes how this proof
should be read: three agents were dead for an hour tonight on an exhausted
account, so a review fleet was the wrong spend, and **the release freeze is the
second reviewer**. Nothing merges tonight regardless, so a light review now plus
a named human reader before merge beats a heavy review at midnight. This proof
is therefore NOT a claim that one pass equals a converged loop. A second reader
(Angel or Kitty) is requested on the PR.

Validation: `validation_log_run_or_skip` exit 0, 2562 tests passed, 0 failed,
hash `da04067902df`. Subdir CLAUDE.md audit: exit 0.

⚠️ **The validation helper skipped on a stale hash the first time and I nearly
took the green.** It hashes the COMMITTED diff, and my fixes were still in the
working tree, so it answered `skipping - clean entry for hash e88ad8ad04a4
already recorded` about code it had never seen. Committed first, then re-ran and
got a real pass on a new hash. Recording it because a green from a command that
never looked is the exact failure this fleet found six times today.

### WARNINGs

- **engine/status.js:3160 (snapshot)** - A throw while building ONE paneless
  card would take down the entire board, including every Mac agent. Every read
  inside `panelessCard` is throw-safe by inspection (`store.readProfile` catches
  and returns `{}`, `safeAvatar` catches, `selfreport.read` and `liveness.read`
  both answer rather than throw), but that is an argument and not a structure,
  and "additive" is the whole claim of this change. A lost paneless row costs a
  row that did not exist last week; a throw costs everyone their card.
  --> FIXED. Each card is built inside its own guard and a failing key is
  skipped.

- **engine/status.js:3290 (countAgents)** - `unreadableTokens` was changed to
  exclude paneless rows and `unknownFullness` was not, so two readings of one
  absent context disagreed: the same board would say "we could not read it" and
  "there was nothing to read" about the same card. --> FIXED. Both exclude, and
  the comment says they have to move together.

### CONVENTIONs

- **engine/status.paneless-roster.test.js** - The card asks for the additive
  property to be "pinned in both directions: the new case works, the old case is
  untouched". The first version pinned the new case and three absences, and had
  no arm asserting a Mac-only board is unchanged. --> FIXED. Two tests added:
  an all-pane board is exactly the panes with every card `paneless: false`, and
  a Mac agent that gains a token and a beat neither doubles nor loses its card.

### NITs

- **engine/sendertoken.js keys()** - One `readdir` plus one read per token file
  on every `snapshot()`, which is a polling path. Bounded by agent count and the
  same order as the per-agent transcript reads already there. Recorded, not
  changed; if the board ever polls harder this is where to cache.

- **engine/status.js panelessCard** - `runner: null` is a third value in a field
  that has only ever been `'claude'` or `'codex'`, and `web/index.html` reads a
  null runner as Anthropic. That is a display fallback inherited rather than a
  claim made, and what a Windows agent actually runs is a phase 2 question, but
  it is the one field on this card I would want a second opinion on.

### Deliberately NOT fixed here, stated so it is not mistaken for missed

- **Removal does not revoke the token.** `sendertoken.revoke` is called by
  `engine/create.js` and `engine/delete-leftover.js` only, never by the removal
  path. So a removed agent's credential outlives the removal. For the board this
  is consistent rather than new: `safeRoster()` filters removed agents by
  `sessionName`, and a paneless card's `sessionName` is the name the board
  displayed and the person removed, so a removed paneless agent comes off
  exactly as a removed Mac agent does. What survives is the ability to REPORT,
  which is #1124's path and predates this change. It belongs on #1112 as a
  phase 2 item, not in this diff.

### Strengths

- `target: null` makes the safety property structural rather than enforced. The
  three consumers that type into or read a pane already guard `if
  (!card.target)`, so a paneless card takes a refusal path that already existed,
  and the refusal is a sentence a person can read. Nothing new had to be trusted.
- Null and never `''`, for a measured reason: two routes match a reporting
  process with `c.target === body.from_pane` behind a `typeof ... === 'string'`
  gate, so `''` would be matched by `from_pane: ""`. Pinned by a test.
- Every absence is asserted against a live control on the same board, so an
  absence cannot come from a board that was empty for an unrelated reason, and
  the count exclusion asserts the count fires at all before asserting it did not
  move.
- The fixture caught the first version reading a field the producer emits on
  only some cards, which is why pane cards now answer `paneless: false`. The
  test harness found a real shape defect rather than agreeing with the author.
