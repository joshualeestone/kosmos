---
pre_challenge: true
method: challenge-loop
branch: launch-7945
diff_hash: 8f9e5899af147cb3239b4ae3b810b59840b2b7924d776722dee358c4950df8d7
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T16:51:31Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the operator's standing cap of 8 review rounds after iteration 8; round 8's two small fixes, a scope comment and a trailing blank line, were not blind-reviewed)
**Total findings:** 46 (1 BLOCKER from final validation, 13 WARNINGs, 3 CONVENTIONs, 29 NITs)
**Fixed:** 34 | **Deferred:** 12 | **Asked (awaiting user):** 0

Final validation, first run: 26556 pass, 1 fail (ios.privacy-manifest-7352: every Swift folder under ios/ must be an
app target; ios/tools, the renderer, is excluded beside KosmosUITests, commit 7e0bdba860). Second run: 26557 pass,
0 fail, validation PASSED (hash 8f9e5899af14), subdir audit clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/tools/launch-orb/main.swift:17 — renderer filled dots one by one, unlike KosmosOrb (one path per group) --> FIXED (091aefb0d4)
- [WARNING] ios/tools/render-launch-orb.sh:1 — nothing enforces redrawing the PNGs when OrbLogic changes --> FIXED (091aefb0d4, run-orb.sh check)
- [CONVENTION] ios/Kosmos/ShellViews.swift:64 — navy comment still said launch screen --> FIXED (091aefb0d4)
- [CONVENTION] .github/workflows/ios.yml:13 — "navy launch screen" --> FIXED (091aefb0d4)
- [CONVENTION] docs/phone-push-go-live.md:341 — "navy launch screen" --> FIXED (091aefb0d4)
- [NIT] ios/tools/check-app-assets.sh:8 — "both of those names" --> FIXED
- [NIT] ios/README.md:100 — long line --> FIXED
- [NIT] ContentView store-shots build opens on navy --> DEFERRED: not a shipped build
- [NIT] plan: captured (247,245,244) vs #faf9f7 --> FIXED (clause added)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] ios/LogicTests/run-orb.sh:20 — byte-for-byte PNG compare fragile across toolchains --> FIXED (2efeb3a109, decoded pixels)
- [NIT] main.swift:20 — comment cites a review --> FIXED
- [NIT] main.swift:7 — no usage line --> FIXED
- [NIT] ContentView LockView on system background --> FIXED (documented in plan)
- [NIT] plan measurements not reproducible in the diff --> DEFERRED: simulator recordings, stated as such

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] ios/LogicTests/run-orb.sh:10 — orb suite printed PASS before the launch check could fail --> FIXED (cb59149d3b)
- [WARNING] launch colours hand-copied, unchecked against Palette --> FIXED (cb59149d3b, palette guard)
- [NIT] main.swift:63 — Finalize result ignored --> FIXED
- [NIT] run-orb.sh header: directory must hold Assets --> FIXED
- [NIT] check-app-assets.sh: dark variants not checked in Assets.car --> DEFERRED: covered at source by run-orb.sh's tag checks (iteration 5)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 of the above
- [WARNING] run-orb.sh:17 — set -e killed the script before its diagnostic --> FIXED (f402618afd)
- [WARNING] main.swift:58 — pixel budget too loose for one moved dot --> FIXED (f402618afd; control: a 2 px dot fails)
- [NIT] todayTab assumption unguarded --> FIXED (guard added)
- [NIT] plan: capture colour handling --> DEFERRED: stated as such

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] ContentView.swift:284 — a notification-tap launch opens on the navy board page --> FIXED (677f4399ac, documented in plan and README)
- [WARNING] main.swift:63 — pixel budget may be too tight on CI --> DEFERRED: fails safe (red, never a false green); the PR's CI run is its test; one number to change (floor added in iteration 7)
- [NIT] colorset dark tag not checked --> FIXED
- [NIT] imageset light/dark filename swap not checked --> FIXED
- [NIT] run-orb.sh comment "CI reads the first VERDICT" --> FIXED
- [NIT] stray ok line --> FIXED
- [NIT] todayTab regex too exact --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] run-orb.sh:41 — scale not tied to filename; a seventh entry unchecked --> FIXED (231582720e; controls fail)
- [NIT] colorset float format gives a confusing message --> FIXED (hint)
- [NIT] two 120 literals --> DEFERRED: a mismatch fails safe as a size STALE
- [NIT] golds parsed by grep --> DEFERRED: fails loudly
- [NIT] notification-tap path not enforced --> DEFERRED: documented, accepted

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 of the above
- [WARNING] run-orb.sh:37 — six entries not required to cover light and dark at each scale --> FIXED (bb99cb4161; control: six light entries fail)
- [WARNING] main.swift:62 — budget at 1x allows 1 channel; CI drift --> FIXED (floor of 8; a 2 px dot still fails)
- [NIT] "untagged" wording --> FIXED
- [NIT] alpha / colour space / third colorset entry unchecked --> DEFERRED: not plausible edits; fails visibly in the recording
- [NIT] todayTab guard / signed-out default --> DEFERRED: the signed-out launch opens on native sign-in, traced
- [NIT] ios.yml step comment --> FIXED
- [NIT] README long line --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] run-orb.sh:63 — store-shots build out of the guard's scope, unsaid --> FIXED (8627a30b83, comment) [not blind-reviewed: cap]
- [WARNING] pixel budget calibrated on one Mac --> duplicate of iteration 5, DEFERRED
- [NIT] trailing blank line --> FIXED [not blind-reviewed: cap]
- [NIT] palette regex needs exactly two lines --> DEFERRED: fails safe

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | ios/tools/launch-orb/main.swift:17 | BRANCH | dots stacked alpha | FIXED | 091aefb0d4 |
| 2 | 1 | WARNING | ios/tools/render-launch-orb.sh:1 | BRANCH | no staleness guard | FIXED | 091aefb0d4 |
| 3 | 1 | CONVENTION | ios/Kosmos/ShellViews.swift:64 | BRANCH | stale navy comment | FIXED | 091aefb0d4 |
| 4 | 1 | CONVENTION | .github/workflows/ios.yml:13 | BRANCH | stale navy wording | FIXED | 091aefb0d4 |
| 5 | 1 | CONVENTION | docs/phone-push-go-live.md:341 | BRANCH | stale navy wording | FIXED | 091aefb0d4 |
| 6 | 2 | WARNING | ios/LogicTests/run-orb.sh:20 | SELF | byte compare fragile | FIXED | 2efeb3a109 |
| 7 | 3 | WARNING | ios/LogicTests/run-orb.sh:10 | SELF | PASS printed before launch check | FIXED | cb59149d3b |
| 8 | 3 | WARNING | ios/tools/launch-orb/main.swift:18 | BRANCH | colours unchecked vs Palette | FIXED | cb59149d3b |
| 9 | 4 | WARNING | ios/LogicTests/run-orb.sh:17 | SELF | set -e hid diagnostic | FIXED | f402618afd |
| 10 | 4 | WARNING | ios/tools/launch-orb/main.swift:58 | SELF | budget too loose | FIXED | f402618afd |
| 11 | 5 | WARNING | ios/Kosmos/ContentView.swift:284 | BRANCH | notification launch to navy | FIXED | 677f4399ac (documented) |
| 12 | 5 | WARNING | ios/tools/launch-orb/main.swift:63 | SELF | budget may be tight on CI | DEFERRED | fails safe; floor in 7 |
| 13 | 6 | WARNING | ios/LogicTests/run-orb.sh:41 | SELF | scale/extra entry unchecked | FIXED | 231582720e |
| 14 | 7 | WARNING | ios/LogicTests/run-orb.sh:37 | SELF | coverage of six pairs | FIXED | bb99cb4161 |
| 15 | 7 | WARNING | ios/tools/launch-orb/main.swift:62 | SELF | 1x budget of 1 channel | FIXED | bb99cb4161 |
| 16 | 8 | WARNING | ios/LogicTests/run-orb.sh:63 | SELF | store-shots scope unsaid | FIXED | 8627a30b83 |
| 17 | final | BLOCKER | ios.privacy-manifest-7352.test.js:57 | BRANCH | final-validation: ios/tools counted as an app target | FIXED | 7e0bdba860 |

### NITs (non-blocking, across all iterations)
- Store-shots build launches cream to navy (iteration 1), deferred
- Plan measurements are simulator recordings (iteration 2), deferred
- Assets.car dark variants not checked in the built app (iteration 3), deferred: checked at source
- Two 120 literals; golds parsed by grep (iteration 6), deferred: fail safe
- Colorset alpha/colour space (iteration 7), deferred
- Palette regex needs two lines (iteration 8), deferred: fails safe

### Strengths (across all iterations)
- The launch ground matches what a shipped launch opens on (sign-in and Agents on Palette.ground), traced in ContentView
- The launch colours and orb PNGs are checked against their sources (Palette, OrbLogic), with controls that fail
- A fresh-install recording, light and dark, shows no navy frame; the cached-snapshot recording is the control
- The plan names its rejected options, weakest premise and what is not measured
