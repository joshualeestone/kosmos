---
pre_challenge: true
method: challenge-loop
branch: longpress-7678
diff_hash: f3f1dcc252ac4e6d96436e1255371fca2d884df075b10b3f500a27ac2fe3e46e
validation: passed
subdir_audit: passed
timestamp: 2026-11-01T05:39:41Z
iterations: 3
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3. **Converged:** no: round 3 found a WARNING and a NIT, both fixed, and no fourth round ran on those small fixes.
**Validation:** passed (REAL_EXIT=0, 25740 pass, 0 fail, 21:41 CDT), before rounds 2 and 3's fixes. Those are iOS only; after them iOS LogicTests
1826/1826, room 744/744, Debug and Release typechecks clean. CI decides.
**UI, on iOS 27 and 26.5:** the last full run passed 9 of 10 on both, and the control failed as it should. The 10th, the room check, failed on its fixture
(the short room's last posts sit under the banner on a small phone, and a post's frame runs past its bubble). On the long sample room it passes on both.

## Iteration 1
- [BLOCKER] (fixed) a LogicTests source check broke on the new close.
- [WARNING] (fixed) confirming Delete read state at tap time: it holds its target now, with a test.
- [WARNING] (fixed) the panel covered the message on ordinary phones: it may reach the keyboard, roomier side.
- [WARNING] (fixed) rows could land behind the keyboard: the sheet takes landscape, accessibility text sizes and Switch Control.
- [WARNING] (fixed) the #7530 guard passed for the wrong reason.
- [WARNING] (fixed) no way to close without acting: an escape.
- [WARNING] (accepted, in the plan) Delete then Keep it lowers and raises the keyboard.
- [WARNING] (fixed) no room coverage.

## Iteration 2
- [WARNING] (fixed) the panel could still reach under the keyboard; its height is now capped and the rows scroll.
- [WARNING] (fixed) the keyboard's top could go stale: keyboardWillChangeFrame.
- [WARNING] (fixed) nothing tested placement: Board table tests, a reachable last row.
- [WARNING] (fixed) the keyboard-down check could not fail; More had no test; the panel moved under a finger.

## Iteration 3
- [WARNING] (fixed) the place could latch before the bubble was known; a check now asserts it sits beside the message.
- [NIT] (fixed) the More test now starts from the panel.

## Weakest premise
Measured on two simulators at the default text size. In landscape, at accessibility text sizes and with Switch Control, the sheet and its keyboard jump remain, on purpose.
