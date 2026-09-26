---
pre_challenge: true
method: challenge-loop
branch: suggest-inapp-3842
diff_hash: d1da9e29adf4e3dc3b40aac99b1753ad549e646ec7bfd5a6eb990671069e3272
subdir_audit: passed
timestamp: 2026-09-26T00:22:52Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 blind review pass (sonnet), covering BOTH halves of kosmos#3842 together (relay suggest-3842, the web step; kosmos suggest-inapp-3842, in-app).
**Converged:** Yes. 1 blocker and 2 warnings, all taken.

## Iteration 1 (sonnet)
- [BLOCKER] (web) Sign out left the address field filled. The prefill only fills an EMPTY field, so the next sign-in on that browser kept the previous person's name or suggestion. Fixed: Sign out clears the field and its note, and a test pins it.
- [WARNING] (in-app) The enrol flow's field was prefilled with no note. Fixed: it has the same one-line note.
- [WARNING] (both) The note was not tied to the field for a screen reader. Fixed: aria-describedby on all three fields.
- [STRENGTH] The reviewer checked:
  - the generator: the alphabet has no 0 o 1 l i, rejection sampling (cap 248 for 31 characters), and the fallback;
  - the output always passes valid_name;
  - an owned-address account is never prefilled (PLUS_SI_OWNED returns first);
  - the name is client-only and nothing is sent until Save;
  - no em dash in any spelling.

## Measured
- Web: signin.test.js 135/135, and the arrival test is red without the prefill call.
- In-app: web.plus-wizard-3796 6/6, web.code-box 5/5, and render-plus-signin-3478 all passed. Its #3842 arm is red without the prefill call.
- The in-app full suite's 6 reds were contention (the server route files pass alone) plus one real harness break, which is fixed: the code-box slice lacks plusNamePrefill, so the call is typeof-guarded.

## Weakest premise
- People may type over the suggestion with their own name (Splinter's premise, stated on the card); the privacy gain then shrinks. Revisit with data.
