# Pre-challenge proof — win32-inbound-poller-2042 (S1, #2042)

Authored 2026-09-13 20:16 -05:00 (UTC 2026-09-14T01:16Z). Branch
`win32-inbound-poller-2042`, rebased onto `origin/main` `fd0e76ad`.

## What this is

S1 of #2042: the Windows fleet inbound poller for supervised WORKER agents — the
cross-machine last mile that turns a Slack envelope addressed to a live local worker
into a `win32channel.say` into that agent's stdin. Plan:
`.claude/plans/win32-inbound-poller-2042-20260914T002214Z.md`.

Structure: `engine/win32inbox.js` (the tested delivery brain: W1 parse, W2 resolve,
W3 deliver, W4 verdict→cursor) + `tools/windows/kosmos-inbox.ps1` (Slack + cursor I/O,
the reviewable copy of the grown `~/.local/bin/kosmos-inbox.ps1`).

## Convergence (challenge-loop, coordinator-run)

- **Round 1** found 3 real silent-message-loss paths + a nit. All verified correct
  (verdict parity, cursor decisions, orchestrator-cursor independence, security,
  parsing were confirmed sound).
  1. Pagination: a single 100-msg page that advanced the cursor to newest lost an
     older backlog page. → **FIX 1**: deliver mode pages `conversations.history` to
     completion; on incomplete pagination it refuses to advance (retry) rather than
     skip the unfetched oldest page. Confirmed Slack ordering by a real read-only
     fetch (newest-first, `has_more`, 32-char `next_cursor`).
  2. Owned-but-down worker lost: a crashed/restarting owned worker's mail resolved
     `not_local` and was advanced past. → **FIX 2**: `ownedWorkerNames`
     (`win32sessions` names − `remove.isRemoved`) distinguishes "ours but down"
     (`owned_down` → BLOCK + retry) from "not ours" (`not_local` → advance).
  3. `from:`-collision drop: `ownOutgoing = liveNames.has(from)` dropped legit inbound
     from a same-named remote agent. → **FIX 3**: investigated — the app has NO Slack
     sender (`grep postMessage|slack.com|bot_token` = 0 engine hits); workers never
     self-post. Invariant landed: route by `to:` alone; `from:` never suppresses; no
     loop (the poller never posts; the cursor advances past each message once). Skip
     removed from deliver mode.
  4. Nit: sequential stdout-then-stderr read. → **FIX 4**: read both concurrently
     (`ReadToEndAsync`) so neither pipe buffer can deadlock.
- **Round 2** confirmed all 4 fixes correct (name-normalization parity checked
  line-for-line, pagination contiguity sound, no-loop invariant holds). No must-fix.
- **Round 2b** applied two optional nits: NIT 2 (comment: `ownedWorkerNames` needs no
  live-name fallback because `win32sessions.record()` guarantees `rec.name`); NIT 3
  (order Slack `ts` by integer seconds + fixed-width microseconds on BOTH sides, not
  float64, which ties near-simultaneous ts and — with an exclusive `oldest=` cursor —
  risks a duplicate delivery). Follow-up **#3023** filed for the accepted limits.

## Tests

`engine/win32inbox.test.js`: **24/24 pass** (seam-injected: fake live/owned sets, fake
`say`, fake record/isRemoved; never a real agent, pipe, board, store, or Slack).
Covers: parse (incl. malformed), W2 resolve, `ownedWorkerNames` (minus removed;
fail-safe empty), verdict parity with chat.js, placed→advance, unconfirmed→advance+log,
could_not→cursor-unmoved+stop, FIX 1 (>100 backlog delivers the buried older msg),
FIX 2 (owned-down blocks; delivered on the restart retry; removed→advance), FIX 3
(name-collision inbound delivered), NIT 3 (compareTs distinguishes a float-tie pair;
two near-ts deliver once each, cursor at the larger), roster-unreadable→advance nothing,
dry-run, oldest-first.

Orphan guard `engine.reachable.test.js`: pass (every new export reachable via
`runInbox`). Neighboring suites (`win32live`, `win32channel`, `comment-deferral`,
`fixture-discipline`, `web.machine-absence-claims`) pass.

Revert controls (mutate → red → restore via Edit; no `git checkout` on working files):
- W4: could_not advances → verdict-parity + 2 cursor tests red.
- W2: resolveTarget ignores the set → 3 tests red.
- FIX 1 (node): truncate to newest 100 → backlog test red.
- FIX 2: owned-down advances → 2 tests red.
- FIX 3: re-add the from-skip → collision test red.
- NIT 3: sort by `Number()` → near-ts no-dup test red.

Suite comparison: change vs merge-base `fd0e76ad` is 5 ADDED files (module, test, ps1,
plan, this proof) — purely additive, no existing file modified, so no existing test's
name or first-error-line can change. Branch-new test is pure-JS/seam-injected (no
win32-only require at test time) → runs on macOS CI; no win32 gate needed.

Block log: empty on every run (the module/poller make zero `schtasks` calls). Guard
`no-schtasks-preload.cjs` + `KOSMOS_SCHTASKS_BLOCK_LOG` armed, APPDATA/LOCALAPPDATA
sandboxed to scratch, on all runs.

## diff_hash

- merge-base (after rebase): `fd0e76ad71eecf97f963c2d6ade3c9fef45eb354`
- command: `git diff fd0e76ad..HEAD -- ':(exclude).claude/plans/win32-inbound-poller-2042-proof-*.md' | sha256sum`
- diff_hash: `248a58ea4bff96e0b3d6b582a8c26ebdd89c2e8c9fc243598f4dc503caa82dd3`

## Known limits (tracked in #3023)

- Deliver mode BLOCKS forever on a backlog beyond the pagination cap (10k) and has no
  Slack `429`/rate-limit handling; recovery needs the backlog to age out of retention
  or a manual cursor reset.
- Print mode (the `windows-orchestrator` pull) is still single-page and retains the
  truncation loss FIX 1 removed from deliver mode.
- Head-of-line: `could_not` and `owned_down` block the deliver cursor until the target
  recovers or is removed (deliberate no-spool, BLOCK-over-LOSE).
- Q1 (orchestrator model) is PENDING Josh, so S1 is workers-only. S3 (Mac `claude-msg`
  arm) is Splinter's lane.
- Deploying the live `~/.local/bin/kosmos-inbox.ps1` is a separate coordinator/Josh
  release step; the reviewable copy is `tools/windows/kosmos-inbox.ps1`.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anwz2k5SbPCSy3yNnPQEok
