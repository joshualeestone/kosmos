---
pre_challenge: true
method: challenge-loop
branch: communityswitch-4288
diff_hash: 338416986c98298b4cb491f904e6b0c998c7faf13a84c4eaedd86731d1165906
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T08:29:24Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5: no BLOCKER or WARNING, one NIT on a branch inherited from the Daily report row)
**Total findings:** 10 (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 6 NITs)
**Fixed:** 7 | **Deferred:** 0 | **Asked (awaiting user):** 0 | **NIT noted, not acted on:** 3

Also found by my own validation before review 1, not by a reviewer: web.settings-nav pins the Automation
boxes' order, and the new Community box was missing from it (fixed in the review 1 commit).
The validation after review 4 was red on the #2518 surface gate: the new `community-msg` id carries the
token `msg`, which render-unread-edge-3743 and render-agentdm-3414 key on. Neither reads Settings, so
54f16a2f5 carries a `Browser-check-surface:` trailer for each, with that reason.

**Final gate:** validation PASSED on 54f16a2f5 (val_exit=0, audit_exit=0, hash 338416986c98, clean worktree),
10952 pass, 0 fail. engine/communityswitch.test.js 10/10; the new server.test.js route test passes; the
browser check render-community-switch-4288 is all good on a sandboxed board (default ON, OFF note, 403,
a 200 ok:false, the share line in four states, a click, and a refused click).

**What the branch does (#4288 part A):** `engine/communityswitch.js` is the one consent every Community
piece reads (`participating()` = ok && on). No file reads ON (Josh's default, and the migration for
existing installs with nothing to run twice); an unreadable file reads OFF and not ok, and a write over it
repairs toward OFF. `GET`/`PUT /api/community-setting`. The Settings > Automation row from Mona Lisa's
design, below the Daily report. The one-time notice is part B.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] the OFF note promised "until you delete them", and no author delete exists in slice 1 --> FIXED (copy says posts stay up; delete filed as #4313; the check pins no delete promise)
- [NIT] the share's rounding was unpinned --> FIXED (a 2.5% fixture reds a floor)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] an unreadable setting never went through the real route in a test --> FIXED (server.test.js puts a folder where the file should be; an always-ok route reds)
- [NIT] the reason-grep comment credited the wrong line for the +1 --> FIXED
- [NIT] the could-not-read wording differs from the Daily report row --> NOTED (Mona's copy from the card)

#### Iteration 3
**Reviewer model:** sonnet
- [WARNING] a 200 answer with ok:false never reached the browser check --> FIXED (UNREADABLE arm; dropping the ok check reds three assertions)
- [NIT] the OFF note and share line are not live regions --> NOTED (same as the sibling switches' notes)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] a refused save was untested, and the check could not read the message line --> FIXED (CLICK-FAIL arm; removing the refusal handling reds it)
- [NIT] a share with no total read "0%" --> FIXED (reads "not measured yet", pinned)

#### Iteration 5
**Reviewer model:** sonnet
- [NIT] the `typeof r.on !== 'boolean'` guard is unreachable from any fixture --> NOTED (inherited from the Daily report row on main; the engine always normalizes `on`)
**Converged** - no new actionable findings.

### Final Ledger

The per-iteration list above is the ledger; each fix is one commit named with its review number.

### Outstanding questions (ASKED, still unresolved when the run ended)
None. The OFF-note copy change was decided and told to Mona Lisa on #4288.

### NITs noted, not acted on
- The could-not-read wording (2); notes not live regions (3); the inherited boolean guard (5).

### Strengths (across all iterations)
- Every state the privacy switch can be in reaches the page as could-not-read or a true position, never a false Off, and each is pinned in a real browser with a perturbation that reds it.
- The gate the send layer reads is one function, and it can only say yes when the setting was read and is ON.
