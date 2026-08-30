---
pre_challenge: true
method: challenge-loop
branch: plusstates-1615
diff_hash: f1d6dd04aaa7f70df7e4913dc921636dae0a2976bfd944e0a0dfdf677b898722
subdir_audit: passed
converged: false
timestamp: 2026-08-30T19:35:29Z
---

## [CHALLENGE-LOOP] ONE blind round, and it found a BLOCKER. Not converged.

The fleet's weekly allowance was named as the binding constraint, so this branch got ONE
blind round rather than a loop to convergence. **That round returned a BLOCKER**, so a
second would be justified on the evidence and is not being run. `converged: false` is
literal.

### Final Ledger

#### Iteration 1, blind

[BLOCKER] `web/index.html` - I RETARGETED A WORKING LINK TO A LIVE 404. Verified myself
against the live site with a negative control: `/plus` 200/10305, `/+?from=app` 404/8498,
a nonsense path 404/8498 BYTE-IDENTICAL, so `/+` is the generic 404. A link labelled "See
Kosmos+" opening a new tab onto it, two lines under a paragraph saying the website is where
this happens, MISLEADS - the one thing this card's rule does not permit. My reasoning bought
a developer-visible signal and paid with a user-visible break. RESOLVED: reverted to the
path that serves, dependency carded, and the guard now records that `/plus` is pinned
because it SERVES and not because it is RIGHT.

[WARNING] the state 2 email field would have rendered borderless and transparent.
`.cinput` is the COMPOSER class (`border:0; background:none`) and takes its border from a
`.composerbox` ancestor this markup lacks, while every other `.cinput` in the file has one.
RESOLVED: `tk-inp` inside `.field`, this pane's own convention and what the design draws.
Matters more than usual on a card whose premise is seeing the design rendered.

[WARNING] MY OWN ASSERTIONS CEMENTED THE DEFECT. I pinned `state2.hidden = true` in BOTH
branches, encoding "state 2 is never shown" as the rule, so the edit that wires it up would
have gone red. A guard obstructing the intended next step is worse than no guard. RESOLVED:
asserts what must not REGRESS and leaves state 2 free. Perturbed - unconfigured showing the
connected flow REDS, configured showing state 1 REDS, showing state 2 stays GREEN.

[STRENGTH] Four design-versus-code conflicts were surfaced rather than silently decided, and
each reason is recorded where the next reader meets the code.

[STRENGTH] The full suite caught two defects a single-file run could not: the "this Mac"
platform guard, and a duplicate id (`plus-email`/`plus-code` are already owned by the enrol
step, so `getElementById` would have returned the wrong element).

### What was NOT done

**The page was not rendered.** The field-styling finding was read from CSS rules, not seen.
No browser check ran on this branch.

### Validation

Full suite **3163 tests, 3163 pass, 0 fail, exit 0**.
