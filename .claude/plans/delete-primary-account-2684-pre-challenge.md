---
pre_challenge: true
method: challenge-loop
branch: delete-primary-account-2684
diff_hash: f2d4cafae43ded29e53735b40e6992569f3bb0342e8626d0b3ac225dade98fe6
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T19:40:51Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 blind reviewer passes; model rotated opus/sonnet/opus/sonnet/opus (kosmos#2032).
**Converged:** Yes. Iteration 5 (post-merge, blind) returned zero NEW actionable findings.
**Total findings across the run:** iterations 1-4 surfaced real defects (all fixed); iteration 5 found none.

Card #2684: allow removing the PRIMARY (default) connected account, not just secondaries.
Josh ruled it unblocked (move all agents to another account, then delete the original
connection).

### The mid-run merge (why iteration 5 is the binding convergence for this diff)

Iterations 1-4 ran against the pre-merge base. Between those and this proof, the branch
was found STALE: it forked at 06b1a7fe and origin/main had gained 7 commits (#2809, #2805,
v0657, #2808, #2413, #2804, #2807) that also edited server.js and web/index.html. Merging
the branch as-is would have reverted that work, so origin/main was merged in (commit
fb175254, zero text conflicts). Because the merge could have produced syntactically-clean
but behaviorally-broken seams, iteration 5 was a fresh blind review of the MERGED state,
specifically hunting semantic merge damage at the seams. It is the convergence that binds
this diff_hash.

### Per-iteration breakdown

#### Iterations 1-4 (pre-merge, opus/sonnet/opus/sonnet)
Fixed, all committed on the branch:
- [WARNING] iter1: .claude.json rewrite made non-atomic -> FIXED (e7d821b5): temp+rename,
  preserve mode 600, refuse on unparseable (byte-identical on refusal).
- [BLOCKER] iter2: render-accounts-openai browser-check not updated to the live-default
  contract -> FIXED (9500fa6b), satisfying the #1720 coarse gate.
- [WARNING] iter3: no test exercised the production null-configDir default-agent shape
  (the server isDefault fallback) -> FIXED (9cc6ea15): added the coverage arm; documented
  the fallback as LOAD-BEARING.
- [BLOCKER x4] iter4: the kosmos#120 stale-comment CLASS -- the docblocks above
  forgetAccount/removeAccount on BOTH engines and the OpenAI-side server pre-flight still
  said the default is refused -> FIXED (e3bf6b74); added a source-pin for the
  OpenAI-default-Delete render branch; corrected plan test counts; softened an
  over-stated browser-run claim.
- STRENGTHs confirmed by two independent blind reviewers: the atomic write + mode
  preservation; the null-configDir coverage arm.

#### Iteration 5 (post-merge, opus) -- CONVERGED
Fresh blind review of the merged net diff (three-dot origin/main...HEAD). Zero new
actionable findings. Verified by the reviewer:
- Merge seams CLEAN: the three merged-in features and this branch's edits live in disjoint
  regions of server.js (observed-overlay 4700-4788 vs account routes 5342-6383) and
  web/index.html (merged CSS/paintTalk/openDetail vs my CSS 634-906 and
  paintAccounts/acctRowHtml 16,700-17,200) -- which is why the text merge had nothing to
  conflict on. node -c passes on server.js, engine/accounts.js, engine/openaiaccounts.js;
  extracted inline JS from web/index.html parses. No duplicate definitions, no orphaned
  handler, no committed conflict markers.
- Account-deletion logic correct: clearDefaultIdentity atomic + mode-preserving + refuses
  on unparseable; the base==='.claude' branch reachable only for the true <home>/.claude
  (same-home guard); OpenAI removeAccount keeps every non-default guard before rmSync
  (arbitrary-path, sign-in-in-flight, running-agents, existence, identity); running-agents
  guard inlined on both Claude primary branches; button wiring correct (Claude default =
  live Disconnect, no Delete; OpenAI default = live Disconnect + Delete), both through the
  shared [data-forget],[data-remove] handler.
- 126 affected tests pass, 0 fail, count asserted (not a filter-matches-nothing green).

### Validation

- Full suite against the merged tree: 6154 pass. The only reds were 4 tools.release-gate
  (#1455) failures caused by a concurrent install-harness holding the install-gate port
  (#708 footer confirmed load 7.21 + a live board). Re-ran tools.release-gate.test.js in
  isolation after the harness cleared: 26/26 green. So validation is green modulo confirmed
  contention.
- Account test files run individually against the merged tree: 124/124 pass.
- Browser-check gates: #1720 coarse exit 0 (non-vacuous: web/ touched AND
  render-accounts-openai.js assertion updated); #2518 surface-map exit 0 (non-vacuous: two
  per-check override trailers applied for render-disconnect-stop-2570 and
  render-claude-connect-choice-2433, both verified to seed no default row).

### Design decisions (mine, documented on the card)

- Claude default: identity-clear only (clear oauthAccount in <home>/.claude.json, keep the
  dir). OpenAI default: whole-dir rmSync (matches its disconnect-renames-whole-dir model).
  Asymmetric on purpose.
- Claude default gets NO separate Delete button (byte-identical to the now-live Disconnect);
  OpenAI default gets one (whole-dir delete genuinely differs).
- Weakest premise: Josh wants the connection gone from the LIST (identity-clear), not the
  .claude dir wiped. Shipping the honest non-destructive Claude version; he can refine.

### Deferred / non-actionable (disclosed)

- defaultCleared is computed and tested but no caller branches on it yet (kept for a future
  messaging split).
- The ~11 acctCancelSay() call sites are now dead but harmless; full removal deferred (risks
  the live [data-forget]/[data-remove] handler for no behavior gain).
- The plan file's browser-check section describes the updated ASSERTION and the satisfied
  gates; a live pw-runtime browser run was NOT performed this session (CI exercises the
  check). This is the one place the plan could overstate; the sentence was softened.

### Outstanding questions

None.
