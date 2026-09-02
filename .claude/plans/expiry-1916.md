# #1916 — the liveness check was blind to OAuth expiry; validate for real at create

## The incident
On 0.6.22 a real tester (Ben) created a Claude agent that 401'd on its first turn,
and re-authenticating showed a GREEN badge while the agent still 401'd. #1903's
create refusal did not fire.

## Root cause (measured + inferred, both named)
- **`claude auth status` reports a STORED login, not a working token.** `subscription.checkLive` is built on it, so a fully-expired OAuth token badges as
  `loggedIn:true` → CONNECTED. Field proof (Splinter's screenshot): two Claude
  accounts, same email, BOTH badge "Signed in", and an agent on one 401s → an
  expired account renders "Signed in". My own result made this conclusive:
  check-dir == run-dir (accountConnectable and createAgentInner resolve the
  account identically), so the green badge and the 401 describe the SAME account.
- **#1315's `/v1/models` shape does NOT translate.** A Claude account is an OAuth
  SUBSCRIPTION token, not an API key; `/v1/models` validates API keys, so it would
  false-negative live subscription accounts. (My correction to the endorsed
  approach — noted so the next person does not re-derive it.)

## The fix
`create.claudeAccountLive(configDir)` — a REAL `claude -p` call (Claude Code's own
auth, the only reliable validator for an OAuth subscription token). Used ONLY at
the create gate (once per create), never on the badge/poll.
- **Classify by OUTPUT CONTENT, not just exit code:** a dead token can retry and
  time out, printing its 401 before the kill; the captured text still reads dead.
- **Only a genuine AUTH failure is dead (NONE).** Capacity / rate / usage-limit /
  overload / network all FAIL OPEN (UNKNOWN). An account at its weekly cap is a
  live, paid, good sign-in whose real call fails — refusing it would block the
  heaviest users, the false negative this family must not ship (#1315; Splinter
  #1916 added the usage-limit case explicitly).
- **CAPACITY markers must NOT include "Retrying"** — a dead-token 401 co-prints a
  retry line (#874), so keying capacity on it would fail a real dead token open.
- `accountConnectable`'s Claude arm now calls `claudeAccountLive` instead of
  `subscription.checkLive`; refuses only on NONE. OpenAI arm unchanged (an OpenAI
  key IS an API key, so #1315's `/v1/models` is correct there). `createAgent`
  stays sync; the check is at the route/wrapper, like #1315.

## A bug this build caught (worth keeping)
The first cut referenced `subscription.STATE` inside `claudeAccountLive` without
requiring `subscription` in that scope (it was required locally inside
`accountConnectable`). The `ReferenceError` was swallowed by `accountConnectable`'s
fail-open catch → the gate ACCEPTED dead accounts (the exact bug). The tests
caught it only because they assert the REFUSAL, not merely no-throw. Fixed by
requiring subscription inside the function.

## Tests
`engine/create.account-connectable-1903.test.js` (rewritten Claude cases to the
`create.setClaudeProbe` seam) + `server.create-live-1903.test.js`: dead 401 →
refused + remedy; success (exit 0) → accepted; a retrying-then-timed-out dead
token → still refused (content classification); usage/rate/overload → accepted
(fail-open); network/unrunnable → accepted (fail-open); unknown account → probe
never runs; default checked with NO configDir. Route: dead → 400 + remedy + no
birth recorded; connected → not blocked + birth recorded. No regression:
server.projects (122), engine/create (144), agent-import (6).

## Pinned residual (deliberate, fails in the safe direction)
`CLAUDE_DEAD_AUTH` is narrow ON PURPOSE (only genuine dead-sign-in strings, so a
live account is never false-refused). One dead form is therefore uncovered: a
sign-in that prints ONLY a bare "Please run /login" with no 401/auth string. That
slips the create gate (fail-open → accepted) and is caught later by #1884's board
surfacing rather than prevented at create. This is the right trade per Splinter
("only a genuine auth failure counts as dead; never false-refuse a live/heavy
user"), and it must NOT be closed by reintroducing the bare `/login` marker (that
false-refuses live accounts). The non-JSON `authentication_error` form IS covered
(the marker is the bare string). Pinned as a KNOWN GAP test.

## Weakest premise
`claude -p`'s exact output/behavior on a genuinely dead OAuth token is inferred
from #874's captured 401 + Claude Code 2.1.258's strings, not reproduced locally
(all four accounts on this Mac are live). The classification is deliberately
conservative — only a positive auth-failure string is NONE; everything else
fails open — so if the wording differs, it errs toward accepting (never a false
refusal). Confirm against Ben's dead account when available.

## Not in scope (separate)
- **The BADGE** (Splinter's call): do NOT build the expensive per-account probe
  (N×4s + spends the user's model quota on Settings-open — reversible action,
  irreversible consequence). Drive it from OBSERVED outcomes (#1884 already sees
  real 401s): observed-working→green+time, observed-401→dead, never-observed/stale
  →"not checked recently", NOT green. That last row is what fixes Ben's badge.
  Separate card.
- **The picker** (#1917, Kitty): two same-email rows, discriminator + Disconnect.

## After merge
Cut 0.6.23 (this supersedes 0.6.22's insufficient #1903 create gate; only a cut
reaches Ben). Verify served both arms; budget for stale browser-gate checks.
