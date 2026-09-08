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

## MEASUREMENT B — RESOLVED (2026-09-07, throwaway isolated pane)

Ran `claude auth login --claudeai` in an isolated pane (throwaway `CLAUDE_CONFIG_DIR`,
a no-op `open` shadowed on PATH so no real browser and no collision with an active
release cut; the real `~/.claude.json` was untouched — mtime unchanged). The first
screen printed:

```
Opening browser to sign in…
If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?...
Paste code here if prompted >
```

⇒ Both strings are ALREADY recognized by `classifyPane` (connect.js:855+):
`Opening browser to sign in` → browser-open, `Paste code here` → awaiting-code.
`--claudeai` skips the `Select login method` chooser (harmless — the browser
recognizer fires immediately). **No recognizer widening needed.** The weakest
premise is discharged: the existing driver walks the flow unchanged.

## IMPLEMENTED (2026-09-07)

Five edits, reauth signal explicit end-to-end (web → server → engine):
- `web/index.html` (~16277): the reauth POST body carries `reauth: true`.
- `server.js` (~6223/6327): validate `reauth` boolean (400 on non-boolean), thread
  it into the accountDir `connect.start` call.
- `engine/connect.js` `start()` (~958/1001): `const reauth = ...`; the CONNECTED
  short-circuit gate becomes `&& !reauth` — a non-reauth start is byte-identical.
- `engine/connect.js` owner (~1352): `owner` carries `reauth`.
- `engine/connect.js` `launchSignin()` (~1969): push `'auth','login','--claudeai'`
  (multi-arg, bare) after the binary ONLY when `owner.reauth` — first-run launch
  unchanged.

Tests (all perturb-verified — each reds on its own defect, controls stay green):
- `engine/connect.test.js`: #1937 fix arm (connected file + `loggedIn:true` +
  `reauth:true` → NOT connected, launches `auth login --claudeai`); CONTROL (no
  flag → short-circuits, opens nothing); CONTROL (non-reauth launch omits login args).
- `server.connect.test.js`: non-boolean `reauth` → 400.

## BLOCKER found in blind review (2026-09-07) — the fix moved the defect into the tick loop

A fresh blind CTO review found that start()+launch were necessary but NOT sufficient.
Once the re-auth launches, the driver's tick loop has two "config outranks screen"
guards that finish off the FILE-based `subscription.check()`:
- `engine/connect.js` browser-open/awaiting-code arm (~2194)
- `engine/connect.js` unknown-escalation arm (~2086)

For Ben's account the file is stale-CONNECTED from flow start, so on the FIRST
browser-open tick the guard fired `finishConnected()` → wrote `PHASE.CONNECTED`
and `killSession()`'d the still-running `claude auth login` — reporting success
with no code submitted and nothing repaired. The exact card symptom, one layer
deeper. My own self-review missed it (I traced the launch, not the tick loop).

**Fix (tick-loop):** a re-auth may finish off the file ONLY after `login-done`
proves the login actually completed. Track `owner.sawLoginDone` (set when the
CLI shows "Login successful"); both file-outranks-screen arms gate their
`finishConnected` on `(!owner.reauth || owner.sawLoginDone)`. Non-reauth is
byte-identical. Completion for a re-auth now flows through the genuine
login-done/repl path (connect.js ~2384), which is the CLI reporting the login
landed — not the stale file.

**Test:** `#1937 END-TO-END` drives the real tick loop with the file
stale-CONNECTED and the pane held at browser-open, asserts the flow does NOT
finish and does NOT kill the session, then flips the pane to login-done and
asserts it DOES finish. Perturb-verified: reverting the browser-open gate reds it.

Also fixed the review's NIT (redundant `!!` at start()'s reauth extraction).

**Weakest premise now:** that real `claude auth login --claudeai` reaches a
login-done/repl screen on success (so the completion path fires). Measurement B
observed the browser-open + paste screens; the terminal login-done screen is
standard `claude auth login` behaviour but was not driven to completion (needs a
real OAuth). If the CLI ever completes a re-auth WITHOUT a recognised login-done
screen, the flow waits out the 15-min abandoned-signin timeout rather than
finishing — an honest "could not confirm, try again", not a false success.

## MEASUREMENT C — discharges blind-round-5's "premature latch" WARNING

Round 5 sharpened the premise: `owner.sawLoginDone` latches on the login-done
recognizer (`/Login successful|Logged in as/i`). Measurement B used an EMPTY config
dir, but Ben's population is a DEAD-BUT-PRESENT credential — and if `claude auth
login` prints "Logged in as <old account>" reading the STORED identity BEFORE the
new login completes, the latch fires early, the gates open, and the re-auth
finishes off the stale file (the exact defect, on the exact machine).

Measured 2026-09-07: seeded a throwaway `CLAUDE_CONFIG_DIR` with a PRESENT
credential (a real oauthAccount) and ran `claude auth login --claudeai` (browser
suppressed, isolated — real config mtime never moved). First screen was
`Opening browser to sign in…` then `Paste code here if prompted >` — IDENTICAL to
the empty-config case. **No "Logged in as" / "Login successful" text before the
new login.** So `auth login` initiates a fresh browser login regardless of an
existing credential; the login-done text appears only on genuine OAuth completion,
which is exactly when the latch SHOULD fire. This also discharges round 5's second
WARNING (the ungated `repl` arm): `auth login --claudeai` goes to the browser, it
does not drop into the REPL.

Residual (accepted): measured a present VALID credential, not a present EXPIRED
one — but the `Opening browser` print is a property of the `login` subcommand, not
of credential validity, so a dead credential behaves the same or more so. A real
expired-credential end-to-end run still needs a real dead OAuth account and is the
one thing this can only fully close on a real machine (post-launch re-verify on the
served build). The premise is now measured on the present-credential population,
not just the empty one.

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
