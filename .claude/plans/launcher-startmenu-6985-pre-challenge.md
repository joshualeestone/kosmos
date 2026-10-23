---
pre_challenge: true
method: challenge-loop
branch: launcher-startmenu-6985
diff_hash: 05f9b5665a44c652633d0b2593e0f375ed9e11e653baffe6467bf0422de1105e
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T14:28:10Z
iterations: 8
converged: true
---

# Challenge loop: launcher-startmenu-6985 (#6985, launcher half)

Each round was a fresh, blind subagent reviewing origin/main...HEAD with no memory of earlier rounds. Validation: the 13
launcher test files and tools/windows-tests.js on the branch and on a clean origin/main (same results, by reason);
Kosmos.exe rebuilt with the README csc flags after every source change, signed Valid (Kosmos Agent Manager, Inc.),
verify-launcher.ps1 OK.

#### Iteration 1
- [NIT] KosmosLauncher.cs sign-back-in comment still said "Opening Kosmos.exe again ... (the zip's READ ME says so)" --> FIXED, Start menu wording; exe rebuilt and re-signed.
- [NIT] two labels in tools.win-launcher-reproof-6882.test.js quoted "open Kosmos.exe again" --> FIXED.
- (Before this round, a self-run found the new comment put the token RunInstallerDuties inside RunBoardWindow's section, which the #1118 guard forbids --> FIXED by rewording.)

#### Iteration 2
- [NIT] comment and plan said every carry-on path refreshes the shortcut; true for a real build only --> FIXED, scoped to IsKosmosBuild.
- [NIT] the test matched refresh-then-return-null anywhere in the file --> FIXED, pinned per method (one return null in each duties method).
- [NIT] one more comment quoted Kosmos.exe beside the #6882 code --> FIXED.

#### Iteration 3
- [NIT] the window could be started another way than BoardWindowStartInfo --> FIXED, the test pins WindowFlag's 3 uses and the one "--window" literal.
- [NIT] plan's not-changed list missed two strings --> FIXED.

#### Iteration 4
- [NIT] plan's not-changed list missed the stopped-unexpectedly box --> FIXED.
- [NIT] rewritten comment lines exceed ~120 columns --> REJECTED: the file already has about 233 such lines, and a rewrap forces another rebuild and re-sign for no reader benefit.

#### Iteration 5
- [NIT] comment and plan said the READ ME calls the extracted folder deletable; it says the zip --> FIXED; exe rebuilt and re-signed.

#### Iteration 6
- [NIT] comment said the READ ME never sends people to the extracted folder; it does before the Start menu entry exists --> FIXED, scoped to once Kosmos is in the Start menu; exe rebuilt and re-signed.

#### Iteration 7
- [NIT] the test did not pin that only the window process shows the three messages --> FIXED: the browser boxes only in OpenInBrowserInstead, called only from RunBoardWindow; NotConfirmedPage only in BoardWindowForm, made only by ShowBoardWindow, called only from RunBoardWindow. Mutation (OpenInBrowserInstead called from Main) turns it red.

#### Iteration 8
- NOTHING ACTIONABLE.

### Final Ledger
- BLOCKER: 0 found.
- WARNING: 0 found.
- NIT: 11 found, 10 fixed, 1 rejected (comment line length, reasoned above).
- Converged at iteration 8.
