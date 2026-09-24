# Plan: warn ahead of Claude login expiry, one-click /login (#3531)

## Problem (Josh, #admin 2026-09-23 21:47 CDT)
"Or peoples agents will just die." Claude Code shows `⚠ Your login expires in N days · run /login to renew`
in-session, but Kosmos never surfaces it, so a user finds out when the agent stops. Fix: notice it ahead of
time, per account, and offer a one-click renew before anything dies.

## Measured facts (Splinter, verified against the installed bundle 2.1.281)
- Byte-exact banner anchors, pulled from the installed Claude Code binary (NOT guessed): the on-screen line is
  `⚠ Your login expires in <N> days · run /login to renew`. In the bundle the two stable fragments are
  `Your login expires in ` and `run /login to renew`, with the count rendered between them.
- Do NOT detect on the keychain credential `expiresAt`: that is the short-lived ACCESS token (auto-refreshes
  hourly), reads healthy right up to the day the login dies. The in-session banner is the only ahead-of-time signal.
- One `/login` in any single session on a config dir renews the login for EVERY agent sharing that dir
  (e.g. `~/.claude-account-d` = josh@book.io, shared by Leo/Mona/Shredder). The renewed credential is written
  immediately; already-running sessions keep the stale on-screen banner until they cycle.

## Design decision: advisory OVERLAY, not a classify state
`connection_lost` (#3410 PR1) is a classify STATE because the agent is wedged. Login-expiry is different: the
agent is still WORKING. So this is a per-ACCOUNT advisory overlay (mirrors the existing account-badge / OpenAI
liveness overlay resolved in `snapshot()`), never an entry in the classify() precedence chain. It annotates the
account, escalates as N drops, and does not touch working/idle/needs_you.

## Build

### 1. Detector (engine/status.js) - pure, tested
- Add `LOGIN_EXPIRY_BANNER` regex, byte-exact from 2.1.281: match `Your login expires in\s+(\d+)\s+days?` AND the
  `run /login to renew` tail on the tail frame. Capture N.
- `loginExpiryFromText(paneText) -> { daysLeft:N } | null`. Match on the tail (same `matchedLine` discipline as
  `CONNECTION_LOST_MESSAGE`), leading frame/prompt glyphs stripped. Negative control test: normal panes -> null.
- Pin N-days extraction with fixtures for `1 day`, `7 days`, and the exact bundle string.

### 2. Per-account aggregation (snapshot()) - dedup across shared config dir
- For each agent pane that shows the banner, resolve its config dir (launch job `configDir`, falling through
  `configRoots()` for a default-account agent - reuse the existing resolution, do NOT re-walk).
- Aggregate to one advisory per config dir: `{ configDir, account, daysLeft: min(seen), agents: [names] }`.
  `daysLeft` = the smallest N seen for that dir (soonest to die wins).
- CLEAR CONDITION (Splinter's fact): the advisory clears when the config dir's credential file mtime is newer
  than the last-seen banner, NOT when the banner leaves one screen. A running session keeps the stale banner,
  so banner-absence alone would false-clear. Thread the credential mtime like the liveness overlay threads its
  witnessed completion.

### 3. Surface (server + web) - board advisory
- Server: expose the per-account advisories in the snapshot payload the board already consumes.
- Web: an advisory pill/banner "Login for <account> expires in N days" listing the affected agents, escalating:
  info >= 7d, warn < 3d, urgent < 1d. Advisory overlay, does not replace the agent's working/idle chrome.

### 4. Action: one-click renew (server + engine) - pane-gated
- "Renew login" button -> server primitive that runs `/login` in ONE live session on that config dir
  (send-keys to a pane on the dir, same pane-gated discipline as the other agent-directed actions). Renews all
  agents sharing the dir. The advisory then clears on the renewed-credential mtime (step 2), not on the click.
- Never fire into the wrong dir: resolve the target pane from the advisory's configDir, refuse on ambiguity.

## Tests
- Full node suite green (fail 0, cancelled 0).
- New: detector fixtures (exact bundle string, 1/7 days, negative control), per-account dedup (2 agents one dir
  -> one advisory, min days), clear-on-mtime (stale banner + newer credential mtime -> cleared).
- Browser-check for the advisory pill across escalation thresholds + both themes (add to the runner list, README
  index, CI allowlist, and reason-grep count together - a browser-check has FOUR indices).
- Challenge-loop to convergence; proof at `.claude/plans/login-expiry-warn-3531-pre-challenge.md`.

## Weakest premise / what would change the approach
- That the banner text is stable across Claude Code versions. It moved 2.1.280 -> 2.1.281 territory already; the
  regex is anchored on the two stable fragments, and the detector must fail SOFT (no banner match -> no advisory,
  never a crash) so a future wording change degrades to "no warning", not a broken board.
- That `/login` via send-keys into a running session cleanly triggers the renewal flow. Verify on a live session
  before shipping the action; if send-keys /login is not clean, the action falls back to surfacing the instruction
  with the exact dir, and the detection/advisory (the load-bearing half Josh asked for) still ships.

## Sequencing
Sibling of #3410 (auto-recover). Not launch-blocking. Detection + advisory first (Josh's minimum), renew action second.
