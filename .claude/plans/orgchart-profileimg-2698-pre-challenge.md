---
pre_challenge: true
method: challenge-loop
branch: orgchart-profileimg-2698
diff_hash: 112d6cc9a15b291ecaf97ea2d43289d6559e9cfd70e08ee4c51353dc97b7c6f7
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T05:26:06Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 surfaced zero new actionable findings)
**Total findings:** 3 actionable BLOCKERs + several WARNINGs/NITs
**Fixed:** 3 BLOCKERs | **Deferred (documented):** 1 efficiency + 1 test-depth WARNING + 1 NIT | **Out of scope (tracked as #2762):** 1 sibling-surface WARNING | **Asked:** 0

kosmos#2698: found-agents/org-chart avatar kept an agent's OLD profile image after an update, because the org avatar URL was bare and paintOrg skips an identical repaint, so its `<img>` never refetched the no-store image (grid/list rebuild their imgs each poll and did update). Fix: carry an avatar version (`store.avatarVersion` = avatar file mtime) in the snapshot as `avatarVer` and build the org face img as `/api/agent/<name>/avatar?v=<avatarVer>`, mirroring the operator's own `?v=YOU_PIC_V`.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs
**Self-generated:** 0
- [BLOCKER] `avatarVer` reached only the OFFLINE card path (server.js); running/token-known agents build their cards in engine/status.js (two `hasAvatar` sites) with no `avatarVer`, so a normal running agent shipped `?v=0` and stayed stale for the primary org population --> FIXED (cd756c9e): emit `avatarVer` at both status.js sites gated like `hasAvatar` (pane card on `tied`, else 0); status.test.js now asserts the tied pane card carries a real version and the untied stranger carries 0.
- [BLOCKER] CI #1720 web/ browser-check gate refuses a web/ change without a docs/browser-checks touch or a `Browser-check:` trailer --> FIXED (cd756c9e): added the trailer; verified both the coarse and surface gates pass (exit 0, "overridden").

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER (+ 2 WARNINGs, 1 NIT)
**Self-generated:** 0
- [BLOCKER] adding `avatarVer` (a new snapshot number) broke `render-talk-goldencard-2519.test.js` -- the golden-card fixture-match and the non-string-field inventory that policies every new producer number. (I had mis-reported the post-iter-1 suite green off the background task notification's exit code, which was my trailing `echo`; the log's own `EXIT=1` was the real verdict -- lesson: read the log's EXIT line, not the notification.) --> FIXED (7690b051): `avatarVer` is an epoch-ms mtime, the same "unpinned timestamp leaks/drifts" class as `disruption.startedAt`, so pinned to a constant in `neutralise()`, enumerated in all four PIN-LIST copies (capture tool header, render-talk.js, README.md, the goldencard-2519 plan), `pinned.size` bumped 24->25, added to the inventory as a PINNED_NUMBER, and added to the committed fixture. Golden-card test 35/35.
- [WARNING] `avatarVersion` re-derives `avatarPath` independently of the sibling `hasAvatar` (two avatars-dir readdirs per agent per poll) --> DEFERRED (documented): tiny dir, pre-existing per-agent readdir, single-scan fix needs a `{path,ver}` helper threaded through three sites, disproportionate at today's scale.
- [WARNING] the `Browser-check:` trailer skips a DOM assertion of the ORG_HTML repaint guard --> kept, documented: paintOrg cannot run at the node level (heavy DOM deps) and a new Playwright check cannot be locally verified on the night shift; the source-slice proves `avatarVer` is in the URL markup and `html` is built from that markup, so the guard necessarily differs when it moves.
- [NIT] `Math.round` collapses sub-ms re-saves --> accepted (avatar saves are HTTP round-trips, ms apart).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 actionable (1 out-of-scope WARNING, 2 duplicate deferrals)
**Self-generated:** 0
**Converged** -- no new actionable findings.
- [WARNING] `tkFace` (project member-faces, projects.js:874) is the SAME staleness class on the PROJECT surface --> OUT OF SCOPE (disjoint from the #2699 project-view lane); filed as follow-up **#2762** so it is tracked, not lost.
- The repaint-guard-untested WARNING and the double-readdir NIT are duplicates of iteration-2's documented deferrals.
- Verified: `avatarVer` is now emitted at all three card paths paintOrg consumes (server.js:2340, status.js:6418 pane card, status.js:5920 paneless), and the fourth `hasAvatar` site (projects.js:874) is correctly excluded because paintOrg reads only the top-level `LAST` snapshot.

### Final validation
Full node suite on the converged HEAD (7690b051): `REAL_EXIT=0` (green). `tools.release-gate.test.js` passes 26/26 in isolation (a transient contention red on one reviewer's own separate run; not this diff). Affected-file tests: 253/253.

### Strengths
- Root cause traced (no-store route + `<img>` recreation on grid/list vs. the org identity-skip guard freezing a byte-identical bare URL); fix mirrors the codebase's own `?v=YOU_PIC_V`.
- `avatarVer` emitted at all three consumed card paths, each gated exactly like its sibling `hasAvatar` (tied->real version, untied->0).
- Real-behavior tests (store transitions 0/mtime/change/removed; tied>0 / untied==0 pane assertions; versioned-URL + bare-form regression control); new snapshot number handled fully per the golden-card process.
