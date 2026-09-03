# Plan: render-create-made - sync on the making state, not fixed sleeps (kosmos#1948)

## Problem
render-create-made (a browser page-check in the release page gate) failed on main and
blocked the 0.6.23 cut. Two TIMING races, neither a rendering regression (verified: on
0.6.22 the check was 18/18, and a normal live-account create works end to end):
1. The early "seen" mid-state was sampled at a fixed waitForTimeout(500); the making had
   not started by then.
2. The "never sees it" CONTROL sampled at a fixed 4200ms; kosmos#1916 added a real
   `claude -p` liveness probe that blocks create ~7s against a not-live account (making
   draws at ~8s), so 4200ms landed too early. Classified by polling (0 ink at 6s, 3138 at 8s).

## Fix
- Replace both fixed sleeps with waitForFunction SYNCs (timeout 20000ms; the seen arm
  incurs the same ~7s probe latency, so 8000ms would sit on the boundary).
- Seen arm: sync on a progress row AND markInk>200 (the mark is an independent rAF
  animation that can lag the first row), then assert the INDEPENDENT properties (heading
  names the agent, a row still working, not-bordered, on-screen, hello hidden). Mark-
  drawing moved into the sync; a dead mark reds via the sync timeout -> labelled FAIL.
- Never-seen CONTROL: sync on the mark beginning to draw, then KEEP the settle-sleep the
  negative assertions need (no greeting; mark never completes into a green tick).
- Shared INK snippet guards a 0-sized canvas.

## Verification
Full check 17/17; full page gate green. Both arms proven red-capable by perturbation
(wrong heading reds mid-state; green mark reds the never-seen control). #1916 NOT reverted.
The ~7s dead-account create-block is filed as a product trade in #1948.
