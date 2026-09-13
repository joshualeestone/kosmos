---
pre_challenge: true
method: challenge-loop
branch: dmbadge-list-org-2863
diff_hash: 1ded4dc75375be94261ad561955aaea713ec17c90c1b69c55da49d523e9cde6e
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T05:35:00Z
iterations: 8
converged: true
---

<!-- Re-entry after a rebase onto origin/main (PR #2990 already open + green). The rebase had
     ONE conflict, in tools/browser-checks.sh's shared `for n` loop line, resolved additively
     to keep both this branch's render-dm-badges-2863 and another agent's render-win32-board-copy;
     all feature code (web/index.html, render-dm-badges-2863.js, web.dm-badge-2863.test.js) replayed
     byte-identical. Iteration 8 (opus) re-reviewed the rebased diff and the conflict resolution,
     found no issues, and confirmed the clean merge; the full suite re-ran green (6951 pass, 0 fail)
     on the new hash. This proof's diff_hash is the post-rebase value. -->


## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (the 6.0 fix-and-validate pass, then 6 blind reviews)
**Converged:** Yes (iteration 7 found zero new findings)
**Total findings:** 12 (1 initial-validation BLOCKER, 6 WARNINGs, 1 CONVENTION, 4 NITs)
**Fixed:** 8 | **Deferred:** 4 | **Asked (awaiting user):** 0

The card (#2863 residual): the unread-DM bubble on the Agents LIST row and ORG node, reusing the
grid card's dmBadge()/a.dmUnread, and kept visible in the CONSOLIDATED rail. New browser-check
render-dm-badges-2863.js verifies all three views in both themes with negative controls.

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** n/a (validation helper)
**New findings:** 1 BLOCKER
**Self-generated:** 0 (helper failure, Origin BRANCH by instruction)
- [BLOCKER] web.dm-badge-2863.test.js -- the base `.dmbadge` CSS test used an unanchored regex that now matched the new `.onode .dmbadge {` (earlier in source) instead of the base rule, failing "not absolute" --> FIXED (anchor to `\n\.dmbadge \{`)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 0
- [WARNING] web/index.html -- the consolidated rail's catch-all `.lrow > :not(...)` hides the badge (a direct .lrow child) entirely; my first reasoning (blamed .lav overflow) was wrong, the cause is the catch-all --> FIXED (added `:not(.dmbadge)`; browser-check consolidated arm added; plan corrected)
- [NIT] web/index.html -- the `left:44px` comment math read as exact (16+34=50, badge at 44 is a 6px overlap) --> FIXED (comment corrected)
- [NIT] web/index.html -- org DM badge (top-left) near the hover callout for a very long name --> DEFERRED (transient hover, pointer-events:none, centred callout vs top-left badge; rare)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** 0
- [WARNING] web/index.html -- org node button carries its own aria-label, so the descendant badge's aria-label is inert; the unread count is never announced on the org chart --> FIXED (fold the count into the button aria-label, mirroring ', needs you'; guarded)
- [NIT] docs/browser-checks/render-dm-badges-2863.js -- consolidated arm asserted only display, not laidOut --> addressed: tried laidOut, but the minimal harness does not establish consolidated grid geometry (measured), so kept the display-only guard (the precise guard for the exemption) with a documented reason

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0
- [WARNING] docs/browser-checks/render-dm-badges-2863.js -- the surface declaration `dmbadge lrow onode` is broad (lrow/onode are core classes), causing future gate friction --> FIXED then reversed at iteration 5 (see below); net decision recorded there
- [CONVENTION] git log -- two early commits carry the subject `backcrumb: #2863` (an unrelated card's branch name) --> DEFERRED (interactive rebase unavailable here; squash-merge collapses branch subjects into the correct PR title, so they never reach main)
- [NIT] web.dm-badge-2863.test.js -- no source-level regex pinning the lrow/paintOrg wiring (the grid card has one) --> FIXED (added source-regex assertions for both lrow branches + the org dmBadge/dmAria wiring)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 1 NIT
**Self-generated:** 2 (both about this loop's own earlier additions: the iter-4 surface narrowing and the iter-3 dmAria fold -- real refinements, not regenerated prose)
- [WARNING] web/index.html -- dmAria (org aria) re-derives dmBadge's count/cap/pluralization (one-fact-two-places, convention #5); mirrored correctly but unpinned --> FIXED (browser-check boundary-equality guard pins badge span text == aria count at n=1 singular and n=150 -> 99+)
- [WARNING] docs/browser-checks/render-dm-badges-2863.js -- the iter-4 narrowing to `dmbadge` leaves the placement assertions (on .lrow/.onode) unguarded against a restructure of those surfaces --> FIXED (restored `dmbadge lrow onode` with an inline comment recording that a narrower decl was considered and rejected because the check ASSERTS placement on those structural tokens; the gate's staleness-catch is the intended purpose)
- [NIT] web/index.html -- `left:44px` floats right of the smaller 24px consolidated avatar --> DEFERRED (badge SHOWS, the functional requirement, and is guarded; cosmetic offset for a live visual pass; harness cannot verify consolidated geometry)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 1 (about this loop's own dmAria/dmBadge duplication)
- [WARNING] docs/browser-checks/render-dm-badges-2863.js -- the OTHER duplicated predicate, CURRENT-suppression ("don't badge the agent you're reading"), is re-implemented in both dmBadge and dmAria and unpinned --> FIXED (browser-check guard opens the agent as CURRENT and asserts BOTH the badge and the aria "unread" phrase are gone)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0
**Self-generated:** 0
**Converged** -- no new findings; STRENGTHs confirmed the one-fact pins, the a11y fold, the CSS specificity/positioning hygiene, the regex anchor, the consolidated toggle matching production, and no em dashes.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web.dm-badge-2863.test.js:80 | BRANCH | Unanchored .dmbadge regex matched the new descendant selector | FIXED | anchor to `\n\.dmbadge \{` |
| 2 | 2 | WARNING | web/index.html (catch-all) | BRANCH | Consolidated catch-all hides the badge | FIXED | `:not(.dmbadge)` + arm |
| 3 | 2 | NIT | web/index.html:2368 | BRANCH | left:44px comment math misread as exact | FIXED | comment corrected |
| 4 | 2 | NIT | web/index.html (onode) | BRANCH | org badge near hover callout, long name | DEFERRED | transient/pointer-events:none/rare |
| 5 | 3 | WARNING | web/index.html:20757 | BRANCH | org badge aria-label inert inside labeled button | FIXED | fold count into button aria + guard |
| 6 | 3 | NIT | render-dm-badges-2863.js | SELF | consolidated arm display-only | DEFERRED | harness cannot establish consolidated geometry; display is the precise exemption guard |
| 7 | 4 | CONVENTION | git log | BRANCH | two commits say `backcrumb: #2863` | DEFERRED | squash collapses to PR title; no rebase available |
| 8 | 4 | NIT | web.dm-badge-2863.test.js | BRANCH | no source-regex wiring guard | FIXED | added lrow/org source assertions |
| 9 | 5 | WARNING | web/index.html:20733 | SELF | dmAria re-derives dmBadge count/format | FIXED | boundary-equality guard (n=1, n=150) |
| 10 | 5 | WARNING | render-dm-badges-2863.js:2 | SELF | iter-4 narrowing loses placement staleness-catch | FIXED | restored `dmbadge lrow onode` + documented decision |
| 11 | 5 | NIT | web/index.html:2368 | BRANCH | consolidated left:44px cosmetic offset | DEFERRED | badge shows + guarded; live visual pass |
| 12 | 6 | WARNING | web/index.html:20726 | SELF | CURRENT-suppression re-derived, unpinned | FIXED | suppression-equality guard |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- org badge / hover-callout proximity for very long names (iter 2) -- deferred.
- consolidated `left:44px` cosmetic offset for the smaller avatar (iter 5) -- deferred, badge shows + guarded.
- consolidated arm is display-only, not laidOut (iter 3) -- deferred, harness limitation, documented.

### Strengths (across all iterations)
- The badge markup reuses the exact grid-card dmBadge()/a.dmUnread and the org #2577 corner-badge pattern; no double-application; offline agents (which can carry unread DMs) covered.
- Security: the count is coerced via Number() and emitted as String(n)/'99+', never raw; the dynamic aria uses a coerced number; no injection surface (iterations 2-7).
- The one-fact-two-places risk (convention #5) is fully pinned: count/cap/pluralization at boundary cases AND the CURRENT-suppression predicate, badge span vs button aria (iterations 5-7).
- CSS hygiene: `.lrow{position:relative}` reparents nothing (only .lav-scoped absolutes exist, contained by .lav); `.dmbadge` is absolute so it consumes no grid track; the placement overrides beat the base rule by specificity, not source order (iterations 4-7).
- The browser-check is registered in the runner, indexed in the README, self-sandboxes its env, and uses real negative controls on every arm across both themes; the CSS-test regex anchor is load-bearing and verified (iterations 1-7).
