# invitewaits-5373b: the invite check's click-then-sleep arms wait for what they read (#5373)

## Problem
docs/browser-checks/render-federation-invite-4649.js pressed a button, slept a fixed 30 to 700 ms, then read
the screen. On a loaded runner the answer can land after the read (slice C went red on CI twice this way),
and an arm asserting that an answer did NOT do something can pass before the answer lands at all.

## Scope
Only the check file. No product code. The 32 click-then-sleep sites from the card's work list; every other
sleep (fedMembersLoad via evaluate, gate stamps, past-a-timer waits) is left, as the card decided.

## Method
Each site waits for the state its assertion reads, through a page-side signal, with a 4 s cap and
.catch(() => {}) so a missing state still reaches the assertion and fails it:
- Remove/Withdraw: FED_BUSY.size === 0 (added before the ask, deleted when the answer is in or given up
  on). Up to its first await after that delete, the handler runs synchronously: the sentence, the paint, the
  dialog close and the list ask (the stub counts the ask at call time). After that await, the Withdraw and
  timed-out Remove paths refocus once the reload answers, so an arm that read focus there would need its own
  wait. Read in the page code, per arm (not measured): B14 and B18d refocus synchronously; B15e and B11a read no
  focus after; B15i reads focus after, but asserts only that it is not <body>, and fedRemoveDone places it on the
  Members "+" synchronously. B14 also waits for #fed-live (fedSay, 50 ms timer).
- Make: the list's re-ask (__memberUrls) and the new row; a limit line past the in-flight text.
- Copy: untilStatus on the line; C9d the late write's line; C3 polls each step word.
Kept: synchronous opens, deliberate mid-flight reads, the ignored-while-busy press, copyAll's 100 ms.

## Trap
An action can clear the flag you wait on (A10), and an in-flight message is already a message (A11/A12,
found by the first run). Every wait was checked against the handler that produces its signal.

## Verification
- Static browser-check guards (tools.browser-checks*.test.js, browser-checks*.test.js): 94/94.
- The check itself, run twice locally at 3330f0275 (beside another job): 167/167 both runs, 0 FAIL. Then CI browser checks.
