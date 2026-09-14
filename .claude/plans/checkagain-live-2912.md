# Plan: S3 install-blocker unblock (#2912/#2559) -- Next must not be trapped by unreliable accessibility detection

## What finished looks like
On the "Kosmos never sleeps" (S3 Automation) install screen, the **Next** button is
available even when the accessibility grant is not detected-as-granted. A user who has
granted Kosmos accessibility (or whose laptop cannot satisfy the energy pane) can proceed
to finish installing Kosmos, instead of being stuck. The accessibility ask stays fully on
screen (mock, Turn On, the Activated pill, Check again); only the Next TRAP is removed.

## The problem (Josh, fresh 0.6.63 test, P0)
> "I cannot proceed forward to install Kosmos." Josh granted Kosmos accessibility, hit
> Check Again repeatedly, it never saw it, Next never enabled. Only an APP REFRESH picked
> up the grant.

Root cause: the S3 accessibility gate reads `/api/a11y-status` → the native app's own
`AXIsProcessTrusted`, which macOS pins at process start. A running app cannot see a
just-granted accessibility permission until it restarts -- so the reading FALSE-NEGATIVES
the grant, and because the gate hard-blocked Next on a positive not-granted, Josh was
trapped on the last install screen.

## The call (reversible, documented)
Make the accessibility (`tmux`) gate **advisory** (`gatesNext: false`), exactly like the
sleep gate already is (#2587). Rationale:
- Hard-gating Next on a detection that false-negatives is strictly worse than not gating --
  it traps users who DID grant.
- Josh explicitly endorsed this ("Next automatically ready ... if they don't accept the
  accessibility requirements"). Splinter ordered "S3 unblock first."
- The ask stays fully visible (mock + Turn On + Activated pill still drive off
  granted/blocked). Only the Next block is removed.
- **Reversible**: once the detection is made live from the system TCC db (#2559 -- the TCC
  db updates the instant the toggle flips, unlike the pinned AXIsProcessTrusted), re-gating
  is a one-line flip if Josh wants his "unless" (energy non-mandatory while accessibility
  gates).

Weakest premise: fully un-gating lets a user skip accessibility and run degraded agents.
Mitigation: the ask stays prominent; this is the operator-endorsed unblock; #2559 makes the
detection reliable next, at which point re-gating is safe.

## Scope
- S3 only. S2 file-access still gates (a different, non-restart-cached mechanism; not Josh's
  stuck screen). The live-detection fix (#2559) and the both-Kosmos+tmux detection
  (#2189/#2911) are the NEXT PRs, not this one.

## Files
- `web/index.html`: `FR_GATES.tmux` gains `gatesNext: false`; the S3 pane + the stale
  "Next locked until BOTH" framing comments updated.
- `web.firstrun-a11y-1214.test.js`: the gating assertions updated (both sleep AND
  accessibility advisory; count of advisory gates 1 → 2; the S3-Next test reframed to the
  go()-guard mechanism, which stays).
- `docs/browser-checks/render-gated-next.js`: the S3 arms rewritten -- Next stays ENABLED
  when accessibility is not-granted (red-capable the other way: a regression re-adding the
  gate reds it); the poll-unlock arm repointed to S2 (still gates); the Check-again arm
  keeps its immediate-re-poll assertion but asserts the ROW flips to Activated (not Next).

## Verify
- Node: `web.firstrun-a11y-1214.test.js` + gate-family (44/44). No other test asserts the
  old gating (the remaining data-gate="tmux" refs are markup, unchanged).
- Browser: `render-gated-next.js` against a sandboxed board -- ALL CLEAR, incl. the CONTROL
  proving the harness discriminates (assertions non-vacuous). Screenshot: S3 with
  accessibility not-granted shows Next gold/enabled (the un-trap).
- Full suite via challenge-loop / create-pr.

## Flagged for real-Mac verify (NOT proven by a green check)
None for THIS PR (it is browser-verifiable -- it removes a gate). The LIVE detection fix
(#2559) and the tmux TCC prompt appearance (#2910/#2189) are the real-Mac items, in the
next PRs.
