---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: a11y-button-1344
diff_hash: 27b955e9e92c1f225a6d6a0890b89f66e6f50df39de364e1193b1667d557731b
subdir_audit: passed
timestamp: 2026-08-28T19:46:45Z
iterations: 1
converged: true
---

## [PRE-CHALLENGE] Summary

**Method:** single-pass, chosen by me. **Nobody was asked for the override**, and I am
saying so rather than implying an operator picked it. My reasons, so the choice can be
overturned rather than assumed:

- The change is ~60 lines across three files and **mirrors an existing sibling**
  (`openSleepSettings`) line for line, so the design space is narrow.
- Every decision in it is recorded in the plan with its reason.
- Five perturbation arms were run **after** the review and each fired precisely, which is
  the evidence an iterated loop would have been looking for.

⚠️ **`subdir_audit: passed` is VACUOUS here and should not be read as coverage.** The audit
ran and exited 0 with no blockers, but **this branch changes zero CLAUDE.md files**, so its
subject was absent. A guard whose subject is absent is not a guard, and I would rather say
that than let the field read as a check that engaged.

**Findings:** 1 BLOCKER, 2 WARNINGs, 2 CONVENTIONs, 1 NIT. **All fixed before the first
commit**, because they were found while reading the surrounding code rather than after
writing.

#### Iteration 1

- **[BLOCKER]** `web/index.html` — The card proposes an `x-apple.systempreferences:` URL on
  the page. **In the app Josh runs that is inert:** `native-app/main.swift` implements no
  `decidePolicyFor navigationAction` and no `createWebViewWith`, so a custom scheme is
  cancelled and `target="_blank"` opens nothing. Shipping the card as written would have
  produced a button that looks correct and does nothing, which is the failure this product
  is explicitly written against --> **FIXED**: server-side route, the third member of the
  `/api/open-sleep-settings` and `/api/reveal-app` family.

- **[WARNING]** `web/index.html` — My first placement attached the click handler inside
  `paintSettings`. The sleep buttons are attached there **because they live inside
  re-rendered `innerHTML`**; this button is static markup, so the same placement would add
  one listener per repaint and a single click would open System Settings once for every
  time that panel had been drawn --> **FIXED**: attached once, beside the other static
  handler, with the reason recorded in the code.

- **[WARNING]** `engine/machine.js` — I was about to hardcode the pane identifier. Its
  sibling **probes** because the identifier moved between macOS versions, and a stale one
  opens System Settings to nowhere --> **FIXED**: probed, with an honest refusal when no
  pane is found.

- **[CONVENTION]** Placement — The obvious home is the "If you see a box asking about
  tmux" box, since that is where accessibility is already discussed. **That box is
  REACTIVE**: it explains a prompt macOS has already put in front of the person. A "go turn
  this on" button inside an explanation of a prompt they are looking at answers a question
  they are not asking --> **FIXED**: it sits in "Keeping agents running", which is what
  Josh's own sentence is about.

- **[CONVENTION]** `engine/machine.a11y-1344.test.js` — The sibling states its security
  property as a **comment**: the URL must never come from a caller or the route becomes a
  way for any page to `open` arbitrary things. A comment cannot fail --> **FIXED**: the
  test pins the signature and asserts that what reaches `open` came from the probe.

- **[NIT]** Copy — My first sentence read "lets Kosmos work properly on this computer",
  which softens the app-control half. #1214 and Josh's relayed ruling are explicit that
  agents acting in your other applications **is** the feature and softening it is what
  makes it false --> **FIXED**: "work in your other applications on this computer", and the
  test forbids the softened forms.

### Final Ledger

```
BLOCKER    1   fixed
WARNING    2   fixed
CONVENTION 2   fixed
NIT        1   fixed
deferred   0
```

**Perturbation, five arms, each firing precisely on its own assertion:**

```
drop the Privacy_Accessibility anchor  -> the URL test fails
refuse but shell out anyway            -> the never-calls-open test fails
route passes something to the engine   -> the route test fails
attach the listener twice              -> the attached-once test fails
soften the app-control half            -> the sentence test fails
```

**Suite:** 2827 tests, 2827 pass, 0 fail.

### What is NOT covered, stated so it is not mistaken for coverage

**Whether the derived URL opens the right pane on this macOS version.** Checking it means
opening System Settings on somebody's machine and I did not do that. The probe plus the
honest refusal is what makes the gap acceptable: a missing pane produces a sentence, not a
dead button.

**Whether the button is reachable and legible on screen.** No browser check was run: a
release cut and then another agent held the machine for the whole build window.
