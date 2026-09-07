# reauth-login-1937 — the re-auth flow must run a REAL login, not a bare `claude`

kosmos#1937 (core of the #1885 "Ben cluster", Josh Top-10 rank 9). Owner: Ice Cream Kitty
(native/auth). Contested file coordinated: Renet clear (not in connect.js); April offline, her
`reauth-launch-1937` worktree is a stale empty leftover (0 commits, Sep 3); Splinter routed
#1885/#1937 to me by name in today's Top-10.

## The defect (measured, in source)

`engine/connect.js launchSignin()` (~line 1936) does `cmd.push(claudeBinPath())` — a **bare
`claude`, no login argument**. A cold `claude` on a DEAD/expired credential drops into the REPL
("Not logged in — Run /login"), which classifies as `repl`; the driver has no "Select login method"
to walk, the tick re-reads the same config that said CONNECTED, and the flow ends
`finishConnected → phase: connected` **having repaired nothing**. #1922 (re-auth wrote to the wrong
configDir) is MERGED; this is the remaining in-product half.

Two coupled sites (#1937 says both must land as ONE change):
1. **The launch** — `launchSignin` at ~1936: `cmd.push(claudeBinPath())`.
2. **The connected-gate** — `start()` at ~992 (`if (sub.state === CONNECTED)`), and possibly the
   post-install gate in `runFlow` at ~1826/1844. April had a bypass here and REMOVED it rather than
   ship the gate open with a launch that repairs nothing.

## LOAD-BEARING MEASUREMENT A — RESOLVED (by reading, not synthesis)

**Q: does `claude auth status` (what `checkLive` runs) report an EXPIRED token as connected?**
**A: YES — `claude auth status` is EXPIRY-BLIND.** Documented in the #1916 close (commit `1baf3652`,
"auth status is blind to OAuth expiry"); that is exactly why create.js switched to a real
`claude -p` round-trip (`claudeAccountLive()`, create.js:2195/2213). `subscription.checkLive`
(subscription.js:325+) still reports CONNECTED on `parsed.loggedIn === true`, and auth-status returns
`loggedIn:true` for an expired token.

⇒ **The `start():992` gate calls `checkLive`, gets CONNECTED for Ben's expired token, and
short-circuits to `finishConnected` — so re-auth never launches.** The fix therefore needs BOTH:
- **the launch fix** (real login, not bare claude), AND
- **a gate-bypass for an EXPLICIT re-auth** (skip the already-connected short-circuit when the user
  is deliberately re-authenticating).

Note: the Settings BADGE (#1921, server.js:3877) overlays the last observed real-call outcome, so an
actively-401'ing account shows not-green there — but the CONNECT FLOW gate does not use that overlay;
it uses the expiry-blind `check`/`checkLive`. So the gate is still blind. Confirmed by content read;
no expired-token synthesis needed.

## The re-auth-intent signal — RESOLVED

The UI already has a distinct re-auth path: the "Sign in again" buttons (`data-reauth`,
`openAcctReauth(dir, email)` at web/index.html:16495) target a specific account's configDir and
reuse the connect flow "in reauth mode rather than duplicating its flow" (comment at ~15746). BUT
`start(opts)` today accepts only `configDir | timeout | cancellable | env | requireInstallConfirm |
installConfirmed` — **there is NO reauth/force flag**. (The first-run connect POST at
web/index.html:37463 sends only `{ installConfirmed }`; the account re-auth POST sends the configDir.)

⇒ **Add `opts.reauth` (boolean), plumbed from the "Sign in again" POST body → the server route →
`start(opts)`.** When `reauth === true`:
1. **Skip the `start():992` CONNECTED short-circuit** (the user explicitly asked to re-auth a broken
   account; checkLive is expiry-blind so it would otherwise refuse). Scope narrowly so the NORMAL
   connect path is byte-identical (no #1560 regression — a non-reauth start still refuses nothing it
   refused before).
2. **Select the real-login launch** in launchSignin (`claude auth login --claudeai`).

Wiring points to touch: web/index.html (the reauth POST body adds `reauth:true`), the server route
that maps `/api/connect/start` → `connect.start(opts)` (pass `reauth` through), and connect.js
(`start()` gate + `launchSignin()` command).

## MEASUREMENT B (still to run, in a throwaway pane) — decides mechanism details

## Mechanism decision (recommend + rejected, per the ruling)

**Recommend: launch `claude auth login --claudeai`** (an explicit login the CLI cannot ignore).
- The resolved binary is `<home>/.local/bin/claude` (runners #570), confirmed to support
  `auth login` (`--claudeai` = subscription, the default).
- REJECTED — invalidate-credential-then-bare-launch: destructive (leaves the user credential-less if
  the login aborts) and still relies on "removed cred → login-method not REPL", an extra unknown.
- REJECTED — send `/login` into a bare REPL: timing-fragile keystroke injection.
- **Open sub-question for execution:** does `claude auth login`'s pane output match the driver's
  recognizers (`Select login method`, `Opening browser`, `Login successful|Logged in as`)? If not,
  the driver's recognizers need widening. Measure in a throwaway pane before committing the mechanism.

## Guards that MUST survive (this file's regression history)

- **#1560:** never declare a signed-out person connected off a stale paid-plan file. The gate's
  `checkLive` is load-bearing; do not weaken it.
- **#1580:** signed-in ≠ ready — the CONNECTED short-circuit must not skip the binary/install check.
- **tmux argv invariants:** `launchSignin`'s command is deliberately multi-arg + bare (unquoted);
  `env -u CLAUDE_CONFIG_DIR` on the default path (#1922). A login arg must be added as its own argv
  element(s), not a quoted string.
- The three in-flow `finishConnected` sites run on the ~700ms tick — do NOT add a subprocess there.

## Done looks like (from the card)

1. Pressing re-authenticate on a broken account runs a REAL sign-in (a login-method chooser / browser
   flow the driver walks), not a REPL that reports connected.
2. A test that can return the dangerous answer: drive a pane to a genuine 401, press the button,
   assert the flow does **not** end `connected` without a credential having changed.
3. The gate change (if the measurement says it's needed) and the launch fix land together, with that
   test — which only becomes possible once the launch works.

## Build order

1. Measurement A (auth-status on expired token) → decides gate change.
2. Measurement B (`claude auth login` output vs driver recognizers) → confirms/adjusts mechanism.
3. Implement launch fix (+ gate bypass for explicit re-auth iff A requires).
4. Test per the spec (mocked launcher/driver asserting no finishConnected without a cred change).
5. `/challenge-loop` to convergence (this file has a history of subtle measurement errors — expect
   real findings), then PR for the Kosmos team to review (agent-workforce PR, per my brief).

## Weakest premise

That `claude auth login` in the bundled/resolved claude drives a flow the existing driver can walk. If
its UX diverges, the change grows to include the driver recognizers. Measurement B settles it before
any code is committed.
