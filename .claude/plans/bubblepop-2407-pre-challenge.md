---
pre_challenge: true
method: challenge-loop
branch: bubblepop-2407
diff_hash: 4b8b52fb30326563fc34a195a39d5101831d445b45e22c4f7596face95ef65cf
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T18:17:24Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs)
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 5 NITs
**Fixed:** 5 WARNINGs + 4 NITs | **Deferred:** 1 NIT (with reasoning) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (initial validation pass, 6.0)
Clean baseline: full suite + subdir audit passed, no synthetic findings.

#### Iteration 2 (two independent blind reviewers)
**New findings:** 3 WARNINGs, 1 NIT
- [WARNING] web/index.html ringNewMessages -- `Number(p.unread || 0)` collapsed a null (UNKNOWN, not zero -- server.js withUnread) to 0, rebaselining every project to zero on a transient count-read blip and false-ringing a spurious burst on the next normal poll --> FIXED (a2a2295f: treat null/non-finite as unknown, carry the prior baseline forward, never ring/rebaseline on it)
- [WARNING] web/index.html ringNewMessages -- no exclusion of the currently-open project; the projects poll reads unread=1 before the room's /seen lands, so a message in the room you are reading would pop (the everyday case) --> FIXED (a2a2295f: exclude PJ_CURRENT from the burst, still baseline it; also require a KNOWN prior baseline, so a just-appeared project seeds silently)
- [WARNING] render-bubblepop-2407.js -- the AudioContext was fully stubbed, so a real Web Audio constraint (e.g. exponentialRampToValueAtTime targeting 0) would pass green; the docstring overstated coverage --> FIXED (a2a2295f: run one pop through the REAL AudioContext + trim the docstring)
- [NIT] web/index.html playBubblePop -- two concurrent loadProjects reads could double-pop --> FIXED (a2a2295f: a 250ms coalescing floor, later moved in iter 3)

#### Iteration 3
**New findings:** 1 WARNING, 1 NIT
- [WARNING] the "burst rings once" test could not distinguish once-per-burst (the boolean) from the debounce masking a per-message call --> FIXED (b1eed343: moved the debounce OUT of playBubblePop and INTO ringNewMessages around the single pop call, so playBubblePop always pops when called and a per-message regression rings twice and fails its test; concurrent-load guard preserved)
- [NIT] the static #pjs-sound-toggle had no initial aria-checked --> FIXED (b1eed343: aria-checked="true")

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** -- no new actionable findings. The reviewer traced all 18 loadProjects callers, the null carry-forward across multiple polls, the PJ_CURRENT compare, and both test suites for honesty, and found no blocking issue.
- [NIT] the static toggle had aria-checked="true" but not the `on` class (unpainted markup announced ON, rendered OFF) --> FIXED (aa0f2f1f: class="toggle on")

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 2 | WARNING | web/index.html | null unread collapsed to 0 -> spurious burst | FIXED | a2a2295f |
| 2 | 2 | WARNING | web/index.html | currently-open project could pop | FIXED | a2a2295f |
| 3 | 2 | WARNING | render-bubblepop-2407.js | stubbed AudioContext overstated coverage | FIXED | a2a2295f |
| 4 | 2 | NIT | web/index.html | concurrent-load double-pop | FIXED | a2a2295f / b1eed343 |
| 5 | 3 | WARNING | tests | burst test could not fail on a per-message regression | FIXED | b1eed343 |
| 6 | 3 | NIT | web/index.html | static toggle missing aria-checked | FIXED | b1eed343 |
| 7 | 4 | NIT | web/index.html | static toggle missing `on` class | FIXED | aa0f2f1f |
| - | 2 | NIT | web.bubblepop-2407.test.js | string-slice extraction is brittle | DEFERRED | assert-guarded, fails loud |

### NITs (deferred with reasoning)
- The node test extracts the #2407 block by string-slicing on the column-0 closing brace; it is assert-guarded (fails loud if it cannot bound the function), so a future reformat cannot silently mis-extract. Same class as the sibling checks; left as-is.

### Strengths (across all iterations)
- The null-is-unknown handling carries the prior baseline forward on a global count-read blip instead of collapsing to zero -- the precise spurious-0->N-burst bug a naive implementation ships -- and is pinned by dedicated arms in both the node test and the browser-check (verified against server.js withUnread).
- The 250ms coalescing floor lives at the decision site (ringNewMessages), not inside playBubblePop, preserving the one-ringNewMessages-call = one-pop-primitive-call invariant so a per-message regression stays test-visible.
- The Web Audio envelope avoids both exponential-ramp-to-zero pitfalls (starts and decays at 0.0001, not 0), frees nodes on onended, resumes a suspended context best-effort, and is silent (not a crash) with no Web Audio; the browser-check swaps in the REAL AudioContext for one pop to catch a constraint the stub cannot.
- Accessibility: the toggle uses role="switch" + aria-label + aria-checked painted through paintSwitch; the per-project preference is per-device with a storage-blocked fallback to ON.
