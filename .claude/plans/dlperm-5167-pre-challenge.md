---
pre_challenge: true
method: challenge-loop
branch: dlperm-5167
diff_hash: a4be36ee7fb36f863987da52eed36925028c7a6a93b77fcadd93c51fc1f77633
validation: passed (hash a4be36ee7fb3, on 5f91725067)
subdir_audit: passed
timestamp: 2026-11-18T18:50:17Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus and sonnet alternating; one reviewer at a time; cap of 8 per Splinter's usage rule)
**Converged:** Yes. Round 8 raised no BLOCKER, MAJOR or MINOR; its one NIT is accepted below.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iterations 1 to 6
Each round's findings were fixed in its own commit (8537393321, 6e6b3e6b1f, a5f13c3e1f, cff05805ea, 6e086cadcc,
ca4131d0b2; the commit messages and the plan's review sections carry the detail). Among them: the restart's four
missing conditions (page unchanged, no other alert up, the page is this board, same-origin), the Kosmos+ marking and
downloadsStartedHere membership, the chosen place used only after the response checks and never over a file.

#### Iteration 7
- [NIT] the System Settings sentence was shown for EACCES too (folder permissions, not the privacy pane) --> FIXED
  (EPERM only; downloadRefusedCode; an EACCES control row; the live arm now asserts no Settings sentence)
- [NIT] pane label "Files and Folders" --> FIXED ("Privacy & Security, Files & Folders")
- [DOCS] weakest premise must name WebKit's networking process and Desktop as protected --> FIXED; card check words named
- [DOCS] plan counts and "main frame began" overclaim; count comment wording --> FIXED (2d18e69055)

#### Iteration 8
**Reviewer model:** sonnet
- Verified: row counts match the plan (mode 320, live 74); EPERM/EACCES branch; restart gates and their order; chosen
  place read-and-removed first, used only after response checks, through downloadDestination (lstat, in-flight set);
  marking only on Kosmos+; Return cancels; the page-change guard re-evaluated after the choice.
- [NIT] the Save panel opens on Desktop, itself protected --> accepted (a refusal there is said by "could not be saved
  where you chose"; the needs-device check on the card covers it)

### Validation
- Full validation on 2d18e69055: 1 fail, the bundle-build pin of the mode row count (native-app.computer-mode-4356.test.js
  still 319). Fixed in 5f91725067 (that one line).
- Full validation on 5f91725067: 29794 tests, 0 fail, build passed, hash a4be36ee7fb3 (matches this proof's diff_hash).
- Mode selftest 320/320, live download selftest 74/74 on the 2d18e690 build (5f917250 changes only a JS test file).
