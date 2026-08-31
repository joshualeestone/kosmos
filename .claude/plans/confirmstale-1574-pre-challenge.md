---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: confirmstale-1574
diff_hash: b2dc2991b03b889a053f8119cae036ede59a8bd352d1f6017242edda4cca57f8
subdir_audit: passed
timestamp: 2026-08-30T23:50:24Z
converged: true
---

## [PRE-CHALLENGE] Single-pass self-review

One pair of eyes plus a reviewer who set the test requirement for this card in the channel:
**prove the SERVER refuses when the client lies, not merely that the happy path works.** That
shaped the test file.

## [BLOCKER] (mine) I changed emitted shapes without grepping the test tree first

Five existing guards pinned the exact shapes of the two `/api/connect/start` call sites and
of `frConnectStartConfirmed`. **My own standing rule is to grep the test tree before changing
anything rendered or emitted, and I did not.** They went red in the full suite rather than
before I started --> FIXED: each updated to follow the shape while keeping its invariant, and
each edit says which is which.

⭐ **Two came out STRONGER rather than merely accommodated**, which is the test that an update
is honest:
- the Confirm button is now pinned to `acctAddStart(true)` specifically, so a future edit
  wiring it to `false` - silently making the Confirm button unable to confirm - goes red. The
  old empty-parens pin could not have seen that.
- the request body is now built with `false` as well as `true`, so a body that HARDCODED
  `installConfirmed: true` fails. That hardcode would be this exact card's defect returning.

## [BLOCKER] (mine) The page asserted a consent nobody gave

Found while fixing rather than when filing. `frConnectStart` set `FR_CONN_CONFIRMED = true`
**on the skip path too**, so when the stale snapshot said no install was needed the page
skipped the dialog AND recorded a confirmation --> FIXED: the flag now means what its name
says, and the request carries what a person actually did.

## [WARNING] (mine) I nearly shipped the wrong default, and the friction was the signal

The default-refuse engine is the stronger contract. It broke eleven tests across four files
and my scripted attempt to update them was mis-slicing test spans. **I treated that friction
as evidence rather than as an obstacle**: the churn buys protection against a caller that does
not exist, since `/api/connect/start` is the only route reaching `start()` --> settled as
opt-in at the engine, always-on at the route, with the reasoning and the reversal condition
written into both the code and the plan.

⚠️ **Weakest premise, named:** that the route is the only caller able to reach the install
path. Measured today, not guaranteed tomorrow.

## [STRENGTH] The test drives the defect, not the feature

Every assertion posts the way a STALE page posts - no flag, or an explicit false. A confirming
run appears only as the **control**, because "refused" is otherwise equally consistent with a
sandbox where the route cannot start anything at all. `AGENT_WORKFORCE_CLAUDE_BIN` points at a
path that does not exist on purpose: pointing it at `/bin/echo` like the sibling server tests
would make every assertion vacuous, since no install would be pending to confirm.

## Verification

| perturbation | result |
|---|---|
| engine refusal removed | **7 assertions RED**, control correctly still green |
| page sets `FR_CONN_CONFIRMED` unconditionally again | **the page guard RED**, alone |
| neither | green |

`engine/connect.js` and `web/index.html` each restored to their exact sha afterwards.

Full suite: **3219 tests, 3219 pass, 0 fail**, `SUITE rc=0`. That is 3213 + my 6.
⚠️ Read from the recorded counts, not the harness notice, which reported "exit code 0" for the
earlier run whose recorded status was `SUITE rc=1`.
