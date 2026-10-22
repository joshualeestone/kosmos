---
method: challenge-loop
branch: iostabs-6846
diff_hash: 9d8f52fda7cede6143331bb2e60b3789df5e53f48add766e9555dcd80acb4732
timestamp: 2026-10-22T03:52:29Z
subdir_audit: passed
iterations: 14
converged: true
---

# Challenge-loop proof: iostabs-6846 (kosmos#6846 part b, the iPhone app's five tabs)

Rebased onto main after #6845 (slice 1) merged; the hash covers origin/main...HEAD, part b alone.
The bar has Today, Agents, Projects, Tasks, Settings. Agents is native; the four web tabs share one WKWebView,
moved into the tab showing, and a press opens its section through the board's door (part a, #6848). Tasks is
earned (#3559). Fourteen blind iterations, alternating Opus and Sonnet; each iteration's fixes are in its commit.
Iterations 1-8 converged before the rebase; 9-14 were run on the rebased branch.

#### Iteration 1 (Opus): five warnings, nits, all FIXED (8975d4c)
- A waiting press covered an agent tap; a press was used up by the sign-in page; the bar and page drifted when
  the app moved the bar itself; lock/unlock state; store shots lit the wrong tab.

#### Iteration 2 (Sonnet): two warnings, FIXED (e5c6be3)
- Three-way door answer (opened / refused / absent); drop cuts the old page off. Its premise that .rm-back is a
  chat's back button was wrong (it is a modal backdrop), recorded in the plan.

#### Iteration 3 (Opus): one BLOCKER, two warnings, FIXED (28267d2)
- BLOCKER: a refusal could put the bar on Agents, after which every web tab was refused while the box sat out
  of sight. Tasks timing on a first launch; per-press serials.

#### Iteration 4 (Sonnet): two warnings, FIXED (c7bf3dd)
- The bookkeeping moved into PressTracker (tested); a refusal follows the page's address.

#### Iteration 5 (Opus): one BLOCKER, three warnings, FIXED (16de9ed)
- BLOCKER introduced by iteration 4's refactor: the first press of a signed-in launch was dropped.

#### Iteration 6 (Sonnet): two warnings, FIXED (f3e0a87)
- Return reads wait for the board's poll; the page state is decided in PressTracker (its rule tested). Also
  found while sweeping: two user-facing messages named the removed Board tab.

#### Iteration 7 (Opus): no blocker; two warnings, FIXED (4e2732a)
- Sign-out advice pointed at Today (it is under Settings, Kosmos+); an overclaimed test.

#### Iteration 8 (Sonnet): no blocker, warning or convention finding. Two nits, FIXED after the round (9d2c139)
- The message says "Log out", as the board's button does; Tasks store shots need a seeded flag (plan note).

#### Iteration 9 (Opus, after the rebase): no blocker; three warnings, FIXED (527ba58)
- The bar did not follow section moves the page made itself; a launch round ended on a stale stored 0; a refusal on
  a hidden Tasks section left Today lit over Tasks. Nits: Page.none renamed; a test claim narrowed.

#### Iteration 10 (Sonnet): no blocker; two warnings, FIXED (f810e54)
- A waiting press re-run through isLoading at didFinish could be lost; every load started a new launch round.

#### Iteration 11 (Opus): no blocker; four warnings, three FIXED (aa38a67), one DECIDED
- An older board (no door) held a press for ever; one Mac's Tasks carried to another; following onto hidden Tasks.
- Decided, not changed: Tasks leaving the bar while selected on a return read (a return is allowed to change the
  bar; holding it would show a tab the Mac does not have).

#### Iteration 12 (Sonnet): no blocker; three warnings in following, FIXED by reshaping it (bd93371)
- A waiting press held the bar off following; any address change re-derived the tab (Settings in the wide layout);
  hidden Tasks with Today lit. Now: only a real section change moves the bar, an opened answer puts the bar on the
  tab pressed.

#### Iteration 13 (Opus): one BLOCKER (from iteration 11's fix) and one warning, FIXED (623f1f0)
- BLOCKER: a project's View all on a Mac below the Tasks threshold was pressed back to the board's home, so that
  list could not be reached. Now a hidden Tasks section lights Projects and nothing presses the page away.
- Warning: the bar flickered to Today during the sign-in hand-off; now held while a press waits on a loading page.

#### Iteration 14 (Sonnet): no blocker. Warnings are device-only, named in the plan's device-check list (26a2be0)
- Reselecting the lit tab may not reach the binding on iOS 16 (workaround: another tab first; fix if confirmed: a
  UIKit reselect hook); BoardWeb's WebKit wiring is untested off-device; the door's name lives in #6854.
- An ordering nit in makeWebView with no failure; SwiftUI coalescing two quick address moves (the bar still follows
  the last); answeredTab clearing itself; app-wide Tasks memory. Not changed.

#### Validation
- iOS LogicTests 464/464 at 623f1f0 (the plan commit after it changes no code). Mutants red at every round 9-13
  guard (follow's section-change check, barTab, barHeld, opened moving the bar, the running flag, noDoor waiting
  only on the sign-in host, the per-host reset, one launch round, a launch 0 not ending its round), each with the
  control green.
- Simulator build: see the PR (queued-heavy run of the final tree).
- NOT covered here, named for the device check: see the plan's list (reselect, Tasks entering or leaving on
  screen, the first press through the sign-in hand-off, BoardWeb's wiring, a zero-size host, the board's door).
