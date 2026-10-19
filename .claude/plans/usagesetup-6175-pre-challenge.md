---
pre_challenge: true
method: challenge-loop
branch: usagesetup-6175
diff_hash: 90aa14c7ae8975709e40cc10e3fabf4047b28d1c2ad274c3b70ea87b1fabe4d5
validation: passed
subdir_audit: passed
timestamp: 2026-10-15T01:04:57Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20 (opus odd, sonnet even)
**Converged:** Yes. Iteration 16 was NO FINDINGS; I then found a focus-ring hazard myself, which reopened the loop. Iteration 20 was NO FINDINGS on the final code.
**Validation:** full suite at 3f004bbbf: 20390 pass, 0 fail, PASSED (hash 90aa14c7ae89). The first run, at f18b82951, failed only the #2518 surface gate. The five checks it named were run against the branch and pass, and each is excused by a per-check trailer.
**Browser check (measured at f18b82951):** render-account-usage-6108.js reports "all good" with 108 #6175 PASS lines, in chromium and webkit, both themes. The no-offer mutant is "FAILED" with 96 #6175 FAIL lines and no crash.

kosmos#6175: Settings > AI Models, an existing Claude account whose usage reading is not wired gets a "Set up usage reading" button with an explainer. It calls a new person-only POST /api/accounts/claude/usage-reading, which runs the same ensureStatusLine that account creation runs.

## Iterations

### Iteration 1 (opus)
- [WARNING] The success removed the focused button and left focus on the page. Fixed: focus moves to the row, and the success is said in the status line.
- [WARNING] The API-key test called the real Anthropic API. Fixed: the fetcher is stubbed.
- [NIT] aria-describedby links the button to its explainer. Built.

### Iteration 2 (sonnet)
- [WARNING] Explainer ids derived from the folder could collide. Fixed: a sequence.
- [WARNING] My 500 fix also turned an unreadable body into a 500. Fixed: 400 for an unreadable body, 500 for a fault after reading.
- [WARNING] A paint in flight could clear the success line. Fixed: a 1 s re-claim.

### Iteration 3 (opus)
- [BLOCKER] The re-claim overwrote other writers' sentences and stole focus. Fixed: it takes back only paint-written text and moves focus only when focus is lost.
- [WARNING] The fallback text lowercased the brand. Fixed: only the server's clause is lowercased.
- [WARNING] The 500 leaked a path. Fixed: a plain sentence, with the detail logged.

### Iteration 4 (sonnet)
- [WARNING] The first success write was unguarded. Fixed.
- [WARNING] A refusal did not hand focus back. Fixed.
- [NIT] Browser arms for the re-claim limits. Built.

### Iteration 5 (opus)
- [WARNING] The early return left focus on the page. Fixed.
- [WARNING] The refusal was said on a replaced button. Fixed: it is said on the live button.
- [WARNING] A thrown wiring had no 500 test. Built.

### Iteration 6 (sonnet)
- [NIT] Two minor issues, fixed.

### Iteration 7 (opus)
- [NIT] No arm for a row still showing an old reading. Built (fixture 'stalewired').

### Iteration 8 (sonnet)
- [NIT] The offer hung off the frozen line. Decoupled.
- [NIT] A comment named the old wiring only. Corrected.
- [NIT] Exact folder match. Kept; reason in the plan.
- [NIT] A concurrent writer re-breaking the file. Kept; reason in the plan.

### Iteration 9 (opus)
- [NIT] A repeated refusal was not re-announced. Fixed: the line is emptied, then written 150 ms later.
- [NIT] A repaint dropped focus. Fixed: rows carry tabindex=-1.
- [NIT] A second refresh could outlast the re-claim. Decided, in the plan.

### Iteration 10 (sonnet)
- [WARNING] A stale success loop cancelled a newer refusal. Fixed: ACCT_USAGE_GEN.
- [WARNING] The acctSayTimer "no-op" note was false. Corrected.
- [NIT] The deferred write overwrote other text. Fixed.
- [NIT] An explainer id was used on every row. Fixed.
- [NIT] One more. Kept.

### Iteration 11 (opus)
- [WARNING] A settings file shared by link sent another account's readings here. Fixed: 409 when settings.json resolves outside the folder.
- [NIT] Not person-only. Fixed: isViaScreen, 403.
- [NIT] A failed repaint. Decided; the Decided note was later found false (iteration 13).

### Iteration 12 (sonnet)
- [NIT] The 403 came after the account lookups. Moved before them, mutant-checked.
- [NIT] A test message. Kept.

### Iteration 13 (opus)
- [WARNING] A linked or dangling settings file was offered a button that always fails. Fixed: weeklyBlocked 'linked-settings'.
- [WARNING] My iteration 11 Decided note was false: "set up" was written over the list error. Fixed: paintAccounts returns false and the success stands down.
- [NIT] Three nits, kept, with reasons.

### Iteration 14 (sonnet)
- [NIT] An older press's late refusal blanked the line. Fixed.
- [NIT] A superseding failed paint. Fixed: ACCOUNTS_UNREADABLE.
- [NIT] The Windows test branch. Kept.

### Iteration 15 (opus)
- [NIT] A refusal with no drawn row wiped "Checking". Fixed.
- [NIT] The list's fallback tabindex. Built; removed in 17 as dead code.
- [NIT] A throwing paint left the button disabled. Fixed.

### Iteration 16 (sonnet)
- NO FINDINGS. After it, I found that code-moved focus can draw the Mac-app stroke (#4961). Built no outline on focused rows.

### Iteration 17 (opus)
- [WARNING] My outline rule also hid the list's ring, which Remove and Move use. Fixed: rows only.
- [WARNING] My "no keyboard signal" premise was false. Built a keyboard-only ring (DSEC_KEYBOARD, kbd-landed).
- [NIT] The list-tabindex branch was dead. Removed.

### Iteration 18 (sonnet)
- [NIT] The keyboard ring was lost on a follow-up rebuild. Fixed.
- [NIT] The synthetic key arm's message overstated what it proves. Reworded.

The first real browser run happened between iterations 17 and 19. It showed that the #6175 step had never run: it sat after page.close(). The "mutant red" was the same crash. Both were fixed, and the says were made safe on missing fields so that a missing offer produces FAIL lines, not a crash.

### Iteration 19 (opus)
- [NIT] The no-ring arm passed vacuously off the row. Fixed: it requires focus on the row.
- [NIT] The linked sentence was untrue for a link to nothing. Reworded.

### Iteration 20 (sonnet)
- NO FINDINGS.
