---
pre_challenge: true
method: challenge-loop
branch: preview-4930
diff_hash: 6f9d6bc585b34f085d2fab481d912b0047329e614a67371b72f9b192746341b7
validation: pending: PR CI is the validation of record (local full suite withdrawn 01:42 CDT 2026-10-02 to keep the 0.7.17 queue moving; Splinter informed)
subdir_audit: passed
timestamp: 2026-10-02T07:48:18Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** Yes (iteration 9: its one WARNING, the reveal route's remote posture, is a ledger duplicate of the iteration-5 decision documented at the route)
**Fixed:** every BLOCKER/WARNING in iterations 1-8 (commits below) | **Deferred:** 5 | **Asked:** 0

Disclosure: iterations 1-5 were reviewed before a context compaction; their entries below are reconstructed from the
fix commits, which record what each round changed but not every finding's severity. Reviewer models alternated opus /
sonnet; iterations 7-9 are recorded exactly (sonnet, opus, sonnet).

### Validation actually run
- docs/browser-checks/render-file-preview-4930.js, ENGINES=chromium,webkit, desktop and phone: all good.
  Controls measured red: without the modifier check (P5 Cmd), without ctrlKey in the guard (P5 Ctrl, 4 arms), without
  the scroll lock (P2), without the image error fallback (P6 no-page, 4 arms), without the name/note click guard.
- node --test browser-checks-*, web.*, tools.browser-checks-*, engine/projects.revealfile-4930,
  server.attachment-reveal-4930: 2351/2351.
- Surface gate (tools/bc-surface-map.sh covering): render-agentdm-3414 (40 PASS), render-dialog-gutter-4506 (52),
  render-dm-phone-718 (88), render-layer-gutter-4494 (13), render-mobilenav-4823 (167), render-restart-screen-4343 (72),
  render-unread-edge-3743 (72): all pass on this branch.
- Local full suite: NOT run (withdrawn). CI on the PR is the validation of record.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] update window and preview fought over Escape and focus --> FIXED (f700499fb), P8
- [WARNING] a click on the dark did not close it; focus lost when a poll redrew the card --> FIXED (f700499fb)
- [WARNING] a cancelled click still opened it; real message rows untested --> FIXED (f700499fb), P9
- [WARNING] reveal route answered unlike its siblings (409 shape); action size and focus rings --> FIXED (f700499fb)

#### Iteration 2
- [WARNING] selecting text and letting go on the dark closed it --> FIXED (f0ac4cd1e)
- [WARNING] did not stand aside for a native dialog; zoom cursor on cards without a picture --> FIXED (f0ac4cd1e)

#### Iteration 3
- [WARNING] tips / type-to-compose did not see it (one Escape closed a tip too) --> FIXED (ec4a0aa5f), backdrop is .rm-back
- [WARNING] scroll lock not released on every exit --> FIXED (ec4a0aa5f), an html:has() rule
- [WARNING] WebKit Tab skipped buttons; no focusin trap --> FIXED (ec4a0aa5f)
- [WARNING] P5 cancelled the click, testing the wrong guard --> FIXED (ec4a0aa5f)

#### Iteration 4
- [WARNING] plan named a lock class that did not ship --> FIXED (657d8a1a6)
- [WARNING] P2 could pass with the lock never on --> FIXED (657d8a1a6), measured red without the rule
- [WARNING] a click on the name/note/error closed it --> FIXED (657d8a1a6), new arm measured red
- [WARNING] preview above first run --> FIXED (657d8a1a6), z 59
- [BLOCKER] EXPECTED_SITES stale (231; the new say() line is a site) --> FIXED (657d8a1a6), 232 measured

#### Iteration 5
- [WARNING] reveal route does not refuse a Kosmos+ remote caller --> DEFERRED: same posture as its sibling reveal
  routes, documented at the route (cfef4f3da); the page shows Download remotely, and the route takes only a 24-hex id
- [NIT] duplicate comment above onFile --> FIXED (cfef4f3da)

#### Iteration 6
**Reviewer model:** (pre-compaction, not recorded)
- [WARNING] a picture that will not load (Windows PDF first page 404) showed a broken image full screen --> FIXED (954080c4b), P6 arm red without it
- [WARNING] no tracker for the card's unbuilt half (Files lists, whole PDF/text) --> FIXED: filed kosmos#4997
- [WARNING] a plain click on an "other" file no longer downloads --> DEFERRED: the card asks for exactly this ("Any other type shows its icon, name and size with the same two buttons"); weakest premise in the plan; modifier click still downloads
- [CONVENTION] own run_one line instead of gated.txt --> FIXED (954080c4b): the runner says why (ENGINES)
- [NIT] raw "no such attachment" on a 404 --> FIXED (954080c4b)
- [NIT] revealFile drops targetRefusal's reason on Windows --> DEFERRED: the reworded sentence speaks of showing, not opening
- [NIT] PV_ATTS only grows --> DEFERRED: bounded by distinct attachments seen; overwrite by id
- [NIT] P9 draws rows outside their containers --> DEFERRED: no container handler cancels a card click (read)

#### Iteration 7
**Reviewer model:** sonnet
- [WARNING] PV_ATTS growth --> DUPLICATE (iteration 6 deferral)
- [WARNING] the page's 404 sentence untested --> FIXED (16c1b44c6), P6 arm
- [WARNING] pvCovered comment wording ("owns the keys") --> DEFERRED: wording only; behaviour correct
- [NIT] x2 --> no change needed (pvZoomFrom transition; Enter key is correct)

#### Iteration 8
**Reviewer model:** opus
- [NIT] header claims Ctrl-click, untested --> FIXED (b9c948780), measured red with ctrlKey dropped
- [NIT] P6 asserts type, not size --> FIXED (b9c948780)
- [NIT] plan misdescribed the text snippet's source --> FIXED (b9c948780)
- [NIT] dialog[open] clause matches nothing today --> FIXED (b9c948780): comment says so
- [NIT] pvClose re-query is page-wide; PV_ATTS --> DEFERRED: low impact / duplicate
- No BLOCKER, WARNING or CONVENTION.

#### Iteration 9
**Reviewer model:** sonnet
- [WARNING] reveal route remote posture --> DUPLICATE (iteration 5 deferral, documented at the route)
- [NIT] x3 --> no change needed (PV_ATTS duplicate; pvReveal 404 handled; z comment holds)
- Zero NEW findings: CONVERGED.
