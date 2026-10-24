---
method: challenge-loop
branch: stepupbutton-6616
diff_hash: 850ee43026a1a00ac2e18bf5e38e0d1812ecaa02c96a554660569eaa50093952
timestamp: 2026-10-20T07:52:16Z
subdir_audit: passed
iterations: 12
converged: true
---

# Challenge-loop proof: stepupbutton-6616 (kosmos#6616, R01b part 4: the board's Sign in again)

When this board refuses a remote action for want of a fresh sign-in, and the connector serves a fresh sign-in, the
board offers Sign in again: a same-origin POST form to `/_kosmos/signin?fresh=1` (the gate's route is POST only and
answers 303). Twelve blind iterations with the reviewer model varied. Iteration 10 converged on the first design;
Renet's gate contract then made the route POST only, which reopened it (the button became a form), and iteration 11
found keyboard focus could not reach the ask over first run. Iteration 12 returned only a limit already decided and
written in the code, so it converged. The severities below are reconstructed from the branch's commits after a
context compaction: read them as the finding's class, not a verbatim copy of the reviewer's label.

After convergence the branch was rebased onto main once R01 (#6654) merged (only this branch's 14 commits, clean).
On the rebased tree: its node tests and R01's (61 of 61), both browser-check gates, and the four browser checks it
touches or names in trailers (render-stepupask-6616, render-firstrun-choice-4356 38 of 38, render-layer-gutter-4494
13 of 13, render-restart-screen-4343 78 of 78) all pass.

After the PR opened, CI's full node suite found one red the focused runs could not: the consolidated grid's body-child
headroom guard (web.consolidated-980), because the ask is one more body child and main had added one since. Fixed by
the guard's own named five-site renumbering (repeat(41, auto); rails 42, 43, 44; projects 42 / span 3) and the three
tests that pin those numbers. A mechanical change named by the failing guard, not reviewed in a further round: every
web page test passes on it (3060 of 3060) and both browser-check gates pass.

CI's browser checks then found the phone-width arm of render-stepupask-6616 measured against a fixed 390 px, while
CI's browser keeps a 15 px scrollbar (375 px of page); it now measures against the page's own width (passes locally,
and still fails on overflow or a narrow ask).

#### Iterations 1 and 2
- [BLOCKER] the ask was not wired into the B8 board check: FIXED, check wired in, button only through the gate.
- [WARNING] the ask sat under the restart and update screens: FIXED, it hides under them; check arm with a control.
- [WARNING] first run made the ask inert: FIXED, the ask is first run's one non-inert child.
#### Iterations 3 and 4
- [WARNING] not full width inside the gutter on a phone: FIXED, measured. [WARNING] the alert read more than the sentence: FIXED.
- [WARNING] the check opened first run only through an exemption: FIXED, it opens first run itself (control red without).
#### Iterations 5 and 6
- [CONVENTION] the layers above the ask and the 403 read were unrecorded: FIXED, recorded as measured and decided.
- [WARNING] another computer's refusal raised the ask: FIXED, only this board's own. [NIT] link underline: FIXED.
#### Iterations 7 to 9
- [WARNING] a write getting through did not hide the ask: FIXED. [WARNING] safe-area foot missing: FIXED.
- [WARNING] ANY write hid the ask: FIXED, only the refused write getting through. Focus to the K mark; CSS off a comment.
#### Iteration 10
- No new BLOCKER, WARNING or CONVENTION. Converged on the GET design.
#### Reopened: Renet's contract (the gate's fresh sign-in is POST only, answering 303)
- The button became a same-origin POST form, so the browser follows the 303.
#### Iteration 11
- [WARNING] first run traps focus, so the keyboard could not reach the ask: FIXED, the ask is in the trap's cycle.
- [WARNING] Not now dropped focus outside first run: FIXED, it returns focus into first run (controls red both).
#### Iteration 12
- [WARNING] a retry that lands on a different path leaves the ask up until Not now: DUPLICATE of a decided limit,
  written in the code. Nits: wording already covered by the fallback sentence and comments. Converged.

That measure was still wrong in CI: the run at 354f8d3328 reported the root at 390 while it laid the page out at
375 (sw 375, the fixed ask ending at 359). The arm now takes the smallest of the root's, the body's and the scroll
width (86ba5660b4). Checked against CI's numbers (pass), locally against a sandbox board (pass), and a narrow box or
a sideways-scrolling page still fails.
