# Plan: warn before a Claude login expires, one-click re-login (#3532)

## Problem (Josh, #admin 2026-09-23 21:47 CDT)
"Or peoples agents will just die." Tonight three agents on one account (josh@book.io: Mona/Leo/Shredder)
showed `⚠ Your login expires in 3 days · run /login to renew` in-pane. If it ran out, all three would stop at
once with nothing in the Kosmos UI to say why. Notice it ahead of time, per account, and offer a one-click renew.

## History
Originally filed as #3531 (banner-scrape approach). Splinter filed the better-specified #3532 with the correct
mechanism; #3531 closed as the dup. This plan is #3532. The banner scrape is dropped: it is version-fragile and
only shows near expiry. The keychain refresh-token expiry is the real signal.

## Mechanism (measured on Agent1s 2026-09-23, verified end-to-end)
- macOS keychain, generic password. Service name: `Claude Code-credentials` for the DEFAULT `~/.claude`, else
  `Claude Code-credentials-<first 8 hex of sha256(ABSOLUTE config-dir path, no trailing slash)>`. Matched all 5
  config dirs on the box exactly.
- The body's `claudeAiOauth.refreshTokenExpiresAt` (epoch ms) is the login-death date. `expiresAt` is the
  short-lived ACCESS token (auto-refreshes), so a keychain/expiresAt check reads healthy until the day it dies:
  do NOT use it. Reading refreshTokenExpiresAt gives an exact date at any lead time, version-independent.
- 🛑 Read ONLY that timestamp. Never read, log, thread, or send the token values.
- Confirmed live: the DEFAULT account expires 2026-09-25 09:56 CDT (~1 day). Reported to Splinter to get /login
  run before it dies. account-d already renewed (jumped ~1 month) and correctly drops out of the <=5d window.

## Design: advisory OVERLAY, not a classify state
The agent is still WORKING while its login nears expiry, so this is a per-ACCOUNT advisory overlay, never a
classify() precedence arm. Dedup is per config dir (agents share a dir), and one /login fixes all of them.

## Build

### 1. Detector -- DONE (engine/loginexpiry.js, pure + injected keychain reader)
- `serviceNameFor(configDir,{homeDir})`, `refreshExpiryFor(configDir,{readCred})` (returns only the number),
  `severityFor(daysLeft)` (urgent <=1, warn <=3, notice <=5), `advisoriesFor({accounts,now,warnWithinDays=5,...})`.
- Fail soft: unreadable/absent credential -> no advisory, never a throw. 9 tests incl. secret-discipline
  (returns a number, not the object), fail-soft, measured hash suffixes, per-account, already-expired.

### 2. Wire into snapshot() (engine/status.js) - per-account aggregation
- Group agent panes by their config dir (launch job `configDir`, default when null), collect agent names, and
  call `advisoriesFor`. Thread the resulting advisories into the snapshot payload the board already consumes.
  This is additive: it must not touch classify() or any working/idle read.
- Resolve config dir per agent from the existing job/config resolution; do not re-walk.

### 3. Surface (server + web) - board advisory
- Server: expose per-account advisories in the snapshot payload.
- Web: an advisory pill/banner "Login for <account> expires in N days" listing affected agents, escalating by
  severity (notice/warn/urgent), and an "expired" state. Overlay, does not replace working/idle chrome.

### 4. Action: one-click "Sign in again" (server + engine) - pane-gated
- Button -> server primitive that runs the account's login without a terminal. #3532 notes `claude auth login`
  (with CLAUDE_CONFIG_DIR set) starts sign-in and opens the browser. Renews every agent sharing the dir.
- The advisory clears on the NEXT read of a later refreshTokenExpiresAt (the renewal moves it ~1 month), not on
  the click and not on the stale on-screen banner in already-running sessions.

### 5. Other providers (#3532 item 3) + Windows (item 4)
- Codex/Gemini/Grok: implement the equivalent where it exists, or record here that it does not. (Claude first.)
- Windows: find the equivalent credential store (Homer's parity lane) and mirror.

## Tests
- Full node suite green (fail 0, cancelled 0).
- Detector: done (loginexpiry.test.js). Add: snapshot aggregation (2 agents one dir -> one advisory, min days),
  and the board advisory browser-check across severities + both themes (remember a browser-check has FOUR
  indices: runner list, README index, CI allowlist, reason-grep count - update all four together).
- Challenge-loop to convergence; proof at `.claude/plans/login-expiry-warn-3532-pre-challenge.md`.

## Weakest premise / what would change the approach
- That the keychain service-name scheme (bare default vs sha256-suffix) is stable across Claude Code versions and
  matches how each agent's config dir is actually set. The default reader fails soft, so a scheme change degrades
  to "no advisory", never a broken board; but it would silently stop warning. Mitigation: if a dir has a bare
  entry AND a hashed one, prefer the one Claude Code actually writes for that dir (the default dir uses bare).
- That `claude auth login` via the server primitive cleanly opens sign-in without a terminal. Verify live before
  shipping the action; if not clean, the action surfaces the exact per-account instruction and the
  detection+advisory (Josh's minimum) still ships.

## Scope / sequencing
Not in scope (#3532): auto-renewing the refresh token without the user. Sibling of #3410 (auto-recover). Detection
+ advisory first (Josh's minimum), renew action second, other providers + Windows last.
