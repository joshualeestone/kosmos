---
pre_challenge: true
method: challenge-loop
branch: consolidated-white-bg-3264
diff_hash: 2f4629188055025a713c598d4241d5fb637e3318dfd55ca23bdce551ad72abff
validation: passed
subdir_audit: passed
timestamp: 2026-09-18T15:16:56Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

kosmos#3264 (Josh, brand-owner, 2026-09-18): the CONSOLIDATED view's message ground must be
WHITE (`--k-surface`), matching the tab view. Verbatim: "the background is supposed to be white
just like it is on the tab view." This reverses the #980 iter-5 cream (`--k-bg`) tuning for the
consolidated layout only.

The change is FOUR lockstep CSS flips in `web/index.html`, all scoped to
`html[data-layout="consolidated"] body.consolidated .pj3 > .pjmid` so the tab view is untouched.
The masks/composer must move together with the ground, or a mismatched band or a tail sliver
returns (glaring in dark):
1. `.pj3 > .pjmid` ground (`:4200`): `--k-bg` -> `--k-surface`.
2. `.pjmid .composer` sticky band (`:4235`): `--k-bg` -> `--k-surface` (kept as an explicit
   lockstep pin against future drift).
3. Agent wing-carve `.msg:not(.you) .msg-bd::after` (`:4825`): a new consolidated-scoped
   `--k-surface` override so no cream tail sliver shows on the white ground.
4. Operator's-OWN wing-carve `.msg.you .msg-bd::after` (`:4832`): the symmetric override. The
   carve masks against the GROUND behind the bubble (not the bubble tint), so the own-message
   tail must go white too, or a `--k-bg` sliver shows at its tail tip (an 11/channel darker
   sliver in dark). The room renderer mounts the operator's own posts as `.msg.you` inside the
   consolidated discussion, so this surface is real.

The global (tab-view) `.msg:not(.you)`/`.msg.you` carves and composer stay `--k-bg`, untouched.

**Iterations:** 4 (validation + 3 blind reviewer passes across two models)
**Converged:** Yes (the final blind pass found zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 WARNING (fixed), 2 CI-caught wiring gaps (fixed), NITs
**Fixed:** 3 (own-message carve WARNING; runner wiring; slice-test token) | **Deferred:** 1 (composer redundancy, kept as a deliberate pin) | **Asked:** 0

### Validation

- Browser-check `docs/browser-checks/render-consolidated-white-3264.js` passes 8/8 per theme
  (16/16 light+dark): computed background of the consolidated `.pjmid` ground, sticky
  `.composer`, agent wing-carve `::after`, AND the operator's-own (`.msg.you`) wing-carve all
  resolve to `--k-surface` and are DISTINCT from `--k-bg`; two no-leak controls confirm the
  NON-consolidated (tab) agent and `.msg.you` carves stay `--k-bg`. It pins the TOKEN, not an
  exact rgb, so a Josh retune of `--k-surface` stays green while a regression of any surface
  back to `--k-bg` reds it. A blind reviewer proved it non-vacuous by reverting the `.pjmid`
  rule and watching the check go red, then restoring it clean.
- `browser-checks-indexed.test.js` + `tools.browser-checks-wired.test.js` pass: the check is
  named in `docs/browser-checks/README.md` AND wired into the runner's explicit `run_one` loop
  in `tools/browser-checks.sh` (the runner does not glob; a check must be listed to run).
- `web.consolidated-match-mock.test.js` passes (incl. the full-bleed pin) and
  `web.consolidated-867.test.js` (the #2711 tab-view-white pin) passes -> no tab regression.

### Per-Iteration Breakdown

#### Iteration 1 (validation)
**Reviewer model:** n/a. Browser-check + index + consolidated slice tests PASSED on the tree.

#### Iteration 2 (blind review)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER/WARNING/CONVENTION; 2 NITs.
- NIT (composer override now equals the base rule): DEFERRED, kept as a deliberate lockstep pin.
- NIT (carve override scoped by layout only, not `.pj3 > .pjmid`): FIXED, tightened so the
  "does not leak" property is true by construction.

#### Iteration 3 (blind review)
**Reviewer model:** opus
**New findings:** 1 WARNING.
- WARNING (`web/index.html`): the consolidated carve override was scoped to `.msg:not(.you)`
  only, so the operator's OWN message tail (`.msg.you .msg-bd::after`) still painted `--k-bg` --
  a visibly dark sliver on the white ground in dark mode (11/channel delta). The reviewer
  confirmed `.msg.you` mounts inside the consolidated discussion (room renderer, `:41517`) and
  that the browser-check shared the blind spot (injected only agent messages).
  FIXED: added the symmetric `.msg.you` consolidated override AND a `.msg.you` arm to the
  browser-check (now 16/16). This is the fourth surface above.

#### Iteration 4 (blind review)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER/WARNING/CONVENTION; 1 NIT (this proof text, which iteration 3's fix
made stale -- resolved by this rewrite).
**Converged.** The reviewer exhaustively grepped every `--k-bg` and every `.pjmid`-scoped
background rule and confirmed all four surfaces are `--k-surface` with no missed fifth surface
(the `.att` attachment fill at `:4479` is tab-view-scoped and a pre-existing #2711 decision, out
of scope), confirmed no leak into the tab or DM threads, proved the check red-able, verified the
wiring, and found no em dashes on added lines.

### CI-caught wiring gaps (fixed between iterations)

CI's first `test` run surfaced two real gaps the isolated node/browser runs did not:
- `tools/browser-checks.sh`: the runner uses an explicit check list, not a glob, so the new
  check was never invoked (#1387 `tools.browser-checks-wired.test.js`). Added it to the loop.
- `web.consolidated-match-mock.test.js`: its `.pj3 > .pjmid` pin encoded #980's cream ground;
  Josh's #3264 white ruling supersedes it. Updated the token `--k-bg` -> `--k-surface`, keeping
  the structural pins (`border: 0; border-radius: 0; border-right: 1px solid var(--k-rule)`).

### Convergence

Iteration 4 returned zero BLOCKER/WARNING/CONVENTION. Per the challenge-loop rule, one pass with
zero actionable NEW findings after deduplication and no unresolved ASKED findings = CONVERGED.
The WARNING (iteration 3) was found by an opus pass after two sonnet passes missed it, which is
exactly the model-variation value the loop is built on. No user decision was required.
