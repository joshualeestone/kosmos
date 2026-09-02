---
pre_challenge: true
method: challenge-loop
branch: dirty-form-1786
diff_hash: 128ee82792b8a19ccb5da06a69ecba2f75b43c6ac64890a0e17ed5e3a76c54af
validation: passed (see note)
subdir_audit: passed
timestamp: 2026-09-02T05:21:37Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 produced zero findings of any level)
**Total findings:** 5 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 4 | **Deferred:** 1 (a robustness NIT) | **Asked:** 0

### Validation note
This change is `web/index.html` (a JS behaviour fix in `refillDetails`) + a web test. The canonical
validation helper flakes locally on the non-hermetic engine board tests ("we could not see what is
running") -- #1794 made those hermetic in CI (env-stubbed) but a local `yarn test` still reads the
live board under load; the helper's own output says "a red that is green alone is contention". This
change cannot affect engine board tests. Baseline by targeted runs: full `web.*.test.js` **948/948**
(every web test reads the edited index.html), the new test 2/2, existing create/role tests 13/13.
The PR's hermetic CI (kosmos's first CI, #1828) is the server-side confirmation.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 2 WARNINGs, 2 NITs
- [WARNING] `create-provider` not reset on a role change. --> Scoped out with reasoning (openCreate
  does not reset it either; resetting only here would be inconsistent; a separate broader decision).
  FIXED as documentation + a follow-up note.
- [WARNING] the plan/test claimed "single entry into step two"; import is a SECOND entry. --> FIXED:
  corrected to "refillDetails is the single RESET choke-point; import is a second entry that manages
  its own state and never resets".
- [NIT] test stubbed instrTemplate as a constant, so the name-before-template ordering was not
  exercised. --> FIXED: faithful instrTemplate reading create-name + a doesNotMatch(/Alfred/) assertion.
- [NIT] CREATE_PROJECTS reset is a no-op (picker removed 2026-08-22). --> Kept for uniformity, noted.

#### Iteration 2
**New:** 1 WARNING
- [WARNING] "matches openCreate's reset set exactly" was itself an overstatement: openCreate also
  clears `create-msg` (a user-facing validation status), `LAST_MARK_SEED` and `PENDING_AVATAR`. The
  concrete residue was `create-msg` (a stale status would persist across a role re-pick). --> FIXED:
  added those three to the reset branch (true parity with openCreate's step-two field set), updated
  the test to assert them, and corrected the comment/plan wording.

#### Iteration 3
**New:** 0 of any level. A rigorous line-by-line parity check confirmed the branch now matches
openCreate's step-two field reset exactly (the two apparent omissions -- FILLED_ROLE, owned by the
role-next caller, and LAST_TYPED_NAME, re-derived unconditionally from the cleared name -- are
correct, not gaps). **Converged.**

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | provider not reset on role change | DEFERRED (scoped) | matches openCreate (which also doesn't); follow-up |
| 2 | 1 | WARNING | plan/test | "single entry to step two" overclaim | FIXED | corrected to single RESET choke-point |
| 3 | 1 | NIT | test | instrTemplate stub didn't exercise ordering | FIXED | faithful stub + doesNotMatch(/Alfred/) |
| 4 | 1 | NIT | web/index.html | CREATE_PROJECTS reset is a no-op | NOTED | kept for uniformity, documented |
| 5 | 2 | WARNING | web/index.html | didn't match openCreate (create-msg/mark internals) | FIXED | added create-msg + LAST_MARK_SEED + PENDING_AVATAR |

### Outstanding questions (ASKED)
None.

### The change
`refillDetails`'s `resetDirty` branch (the role-change branch, and the single RESET choke-point --
role-next is the only entry that resets) now resets the same step-two field set openCreate resets:
name, the create-msg status, avatar (+ its input and hint), projects, LAST_MARK_SEED, PENDING_AVATAR
(label/instructions were already reset there; model/account/reports by loadCreateExtras; the mark
redrawn by drawCreateMark). Import is unaffected (FILLED_ROLE=PICKED='own' -> roleChanged=false). A
VM-extraction test runs the shipped function and asserts both arms; proven to go red on a revert.

### Scope / follow-up
- Provider is deliberately out (openCreate doesn't reset it either; resetting only here would be
  inconsistent). A latent provider/model mismatch a reviewer noted is pre-existing and bounded by the
  reachability caveat; follow-up to reset it (in openCreate too) if desired.
- Reachability caveat: a blind review could not find a step-two -> step-one re-pick path in the
  current build; Shredder reproduced the card in a browser, and the fleet cannot run a browser check
  (#1769). The fix is defensive: correct where it fires, harmless where it does not, complete for
  whenever the re-pick path is reachable.

### Product decision
A different role resets the whole (step-two) form uniformly, incl. a typed name. Documented weakest
premise (a name is the person's, not the role's) + what would change it (Josh preferring the name to
survive -> one-line carve-out). Reversible.
