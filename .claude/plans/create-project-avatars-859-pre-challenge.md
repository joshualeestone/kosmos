---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: create-project-avatars-859
diff_hash: 327303a266f18aa1107b405c8ec293592c6cb88f0693e3d41c342484723aa712
timestamp: 2026-08-25T18:24:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: create-project-avatars-859

**Single pass, explicit override, labelled honestly.** /code-review has
been unavailable in this session all night. Self-reviewed instead. Low
blast radius (one function, one CSS rule, both scoped to the New
project form).

## Iteration 1 (single pass, self)

[STRENGTH] **Reused `pjMember()`'s face markup rather than inventing a
new avatar treatment.** Checked how the same identity mark is drawn
elsewhere (the grid card, the list row, `pjMember` itself) before
writing anything new, and matched the `hasAvatar`-gated
photograph-or-tinted-initials pattern exactly, so this row cannot
disagree with any other surface about the same agent's face.

[BLOCKER] (found and fixed before this proof) **The existing test for
`addAgentsHtml()` lifts the function in isolation with a fixed
parameter list**, and adding calls to `discTint`/`discInk`/`initials`
inside the function broke it (`ReferenceError`) since the test's
`new Function(...)` call didn't inject them. Caught by actually running
the suite, not assumed correct from reading the diff. Fixed by adding
the three as stand-in parameters, matching the file's own established
convention for `esc`/`roleLine`.

[STRENGTH] **Real live-server visual verification**, not just the unit
test. Fixture built with `test-support/fleet.js`'s `agent()`/`line()`
(never hand-typed). Opened New project, added a real fixture agent,
confirmed the row shows a tinted avatar circle with initials, name, and
role, at visibly greater height than the plain-text row before.

## Verification

- `node --test` / `npm test` (full suite): 0 failures, exit 0.
- `bash tools/browser-checks.sh` (full suite): all page checks passed.
- Real live-server Playwright verification, described above.

### Final Ledger

1 BLOCKER found and fixed before this proof (a test's fixed injection
list not covering the new helper calls). 0 findings remain open.
