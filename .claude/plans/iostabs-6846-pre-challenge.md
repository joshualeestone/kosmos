---
method: challenge-loop
branch: iostabs-6846
diff_hash: ca8f03d5c5c6ee95454eb9e6ff837e8a9c7a50efecf1ad8c1cee45f6a500ebd8
timestamp: 2026-10-21T20:12:14Z
subdir_audit: passed
iterations: 8
converged: true
---

# Challenge-loop proof: iostabs-6846 (kosmos#6846 part b, the iPhone app's five tabs)

Stacked on nativeagents-6838 (#6845, slice 1); the hash covers origin/main...HEAD, so it includes slice 1.
The bar has Today, Agents, Projects, Tasks, Settings. Agents is native; the four web tabs share one WKWebView,
moved into the tab showing, and a press opens its section through the board's door (part a, #6848). Tasks is
earned (#3559). Eight blind iterations, alternating Opus and Sonnet; each iteration's fixes are in its commit.

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

#### Validation
- iOS LogicTests 440/440 at 9d2c139. Mutants red (each run against a modified copy): the Tasks gate, the root
  guard, the typeof guard, the try/catch, === true, the refused mapping, the error check, refusal to Agents, a
  door that throws, the serial check, the read generation check, the lock reset, the agent-tap serial, stacked
  read rounds, a press with no web view, a return round stopping at its first answer. Control runs stayed green.
- NOT covered here, named for the device check: BoardWeb's call order, Tasks entering or leaving the bar on screen,
  a press on the selected tab, the board's first layout in a zero-size or hidden host.
