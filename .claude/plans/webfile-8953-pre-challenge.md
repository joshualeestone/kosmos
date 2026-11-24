---
pre_challenge: true
method: challenge-loop
branch: webfile-8953
diff_hash: 5a94ef9e85d799f6d248ce1efbd5fab695193f09b3193ff2c2aeca9eff796dda
validation: failed (load flakes, not this branch; see Validation below)
subdir_audit: passed
timestamp: 2026-11-24T09:48:17Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind review rounds (Opus and Sonnet alternating).
**Converged:** No. The loop stopped at the fleet's 8-round cap (Splinter's rule: past 8 only for a BLOCKER). Round 8
raised no BLOCKER; its 3 WARNINGs and NITs are filed as kosmos#8966. This is not a user stop, and it is not zero findings.
**Total actionable findings:** 1 BLOCKER, 19 WARNINGs, 4 CONVENTIONs, plus NITs
**Fixed:** 20 | **Deferred:** 1 (plan residual) | **To follow-up card #8966:** 3 | **Asked:** 0

## Validation
- 6.0 (initial) was stopped before it ran (it was still queued when round 1's fixes began), so the first full run was 6j.
- 6j run 1 (4b49958179): 2 failures, both mine. The #5995 ping sweep (my probe page's ping attribute ended in /ping) and
  the #6838 iPhone-requests sweep (the UI test's control was a URL request with a runtime port). Fixed in 0a9228d11b
  (later rebased to 9c1e337f40): the probe path renamed, the control made a TCP connection. Both sweeps pass.
- 6j run 2 (0a9228d11b): 3 failures, all #8213 [pwsh]. pwsh crashed starting ("String cannot have zero length", exit
  null). engine/win32-psquote-8213.test.js passes 27/27 alone, twice.
- 6j run 3 (9c1e337f40, rebased, the reviewed HEAD): 30870 tests, 3 failures, all timeouts in CLI tests (#2909 20 s,
  #4582 8.9 s, #8721 30 s) while two other suites ran on the Mac. Alone: cli.post-stdin-2909 24/24, cli.reply-stdin-4582
  11/11, cli.claim-6946 12/12. Each 6j run failed on different tests.
- This branch changes nothing outside ios/ and .claude/plans/ (0 such files, measured). Judged load flakes; not proven.
  CI's node suite is the next witness. Subdir audit: rc 0 on every run.
- iOS: ios/LogicTests/run.sh PASS 2246/2246 and every run-*.sh PASS on the rebased HEAD; WebFileUITests passes on iOS 27
  (rebased HEAD) and on iOS 26.5 (before the rebase).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 2 CONVENTIONs, NITs
**Self-generated:** 0
- [BLOCKER] BoardClient sample page / WebFileUITests: preconnect and its relatives untested --> FIXED (01d9a9f5e3): probe page extended; measured 0 connections with the rule, 40 without (control)
- [WARNING] WebFileView: VoiceOver / keyboard activation not covered by the touch block --> FIXED (01d9a9f5e3): links, areas, forms, <link> renamed (Board.withoutLinks)
- [WARNING] WebFileView: empty sheet when the rule fails or nothing to draw --> FIXED (01d9a9f5e3)
- [WARNING] WebFileView: text read on the main thread on every redraw --> FIXED (01d9a9f5e3)
- [CONVENTION] isWebDocument comment stale; probe "every way" overclaims --> FIXED (01d9a9f5e3)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] BoardLogic withoutLinks: UTF-16 pages keep live links --> FIXED (46d5a32e2b): converted first, zero bytes without a mark refused
- [WARNING] plain-named page typed text/html reaches Quick Look --> FIXED (46d5a32e2b): Board.fileName
- [WARNING] no size cap --> FIXED (46d5a32e2b): 8 MB

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 1 (prose: filePreview comment, claim deleted)
- [WARNING] WebFileView filePreview comment stale --> FIXED (387176f990)
- [WARNING] size checked after reading --> FIXED (387176f990)
- [WARNING] one message for every cause --> FIXED (387176f990): a too-large message

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs
**Self-generated:** 1 (prose, withoutLinks comment)
- [WARNING] MathML href and the comment's claim --> FIXED (8795ac0d6e): comment narrowed (renamed in iteration 5)
- [WARNING] VoiceOver readability with touches off --> FIXED as evidence in the plan: the UI test reads the page's text through the accessibility tree
- [WARNING] does the SVG draw --> confirmed by the UI test and its screenshot

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 1 (withoutLinks, code)
- [WARNING] srcdoc / data: frames can hold links --> FIXED (ad7efd3963): frames, object, embed renamed
- [WARNING] MathML href is a link for VoiceOver --> FIXED (ad7efd3963): math renamed; the control arm showed the UI test cannot see this layer, so logic tests pin it
- [WARNING] Share sheet thumbnail renders the page --> FIXED (ad7efd3963): fixed SharePreview

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 1 (text path, code)
- [WARNING] UTF-16 XML cut at an odd byte shows garbage --> FIXED (c649108c15)
- [WARNING] binary plist shown as text --> FIXED (c649108c15): Board.shownText

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 CONVENTIONs, NITs
**Self-generated:** 1 (shownText, code)
- [WARNING] UTF-16 cut inside an emoji --> FIXED (1ce79f02b7), both byte orders tested
- [WARNING] the UTF-16 test could not reach that case --> FIXED (1ce79f02b7)
- [CONVENTION] FilesView and RoomView comments stale (3) --> FIXED (1ce79f02b7)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, NITs
**Self-generated:** 0
- [CONVENTION] FilesLogic header stale --> FIXED (4b49958179)
- [WARNING] UI test sleeps and the one unexplained hang --> FOLLOW-UP kosmos#8966
- [WARNING] Content-Disposition over the relay not measured --> FOLLOW-UP kosmos#8966
- [WARNING] a type with parameters is judged differently by name and type --> FOLLOW-UP kosmos#8966 (not a regression from main)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | BoardClient.swift sample page | BRANCH | preconnect untested | FIXED | 01d9a9f5e3 |
| 2 | 1 | WARNING | WebFileView.swift | BRANCH | non-touch activation | FIXED | 01d9a9f5e3 |
| 3 | 1 | WARNING | WebFileView.swift | BRANCH | empty sheet on failure | FIXED | 01d9a9f5e3 |
| 4 | 1 | WARNING | WebFileView.swift | BRANCH | text read on main thread | FIXED | 01d9a9f5e3 |
| 5 | 2 | WARNING | BoardLogic.swift withoutLinks | BRANCH | UTF-16 bypass | FIXED | 46d5a32e2b |
| 6 | 2 | WARNING | WebFileView.swift filePreview | BRANCH | typed page to Quick Look | FIXED | 46d5a32e2b |
| 7 | 2 | WARNING | WebFileView.swift | BRANCH | no size cap | FIXED | 46d5a32e2b |
| 8 | 3 | WARNING | WebFileView.swift | SELF | stale filePreview comment | FIXED | 387176f990 |
| 9 | 3 | WARNING | WebFileView.swift | SELF | size checked after read | FIXED | 387176f990 |
| 10 | 3 | WARNING | WebFileView.swift | BRANCH | one message for all causes | FIXED | 387176f990 |
| 11 | 4 | WARNING | BoardLogic.swift | SELF | MathML href claim | FIXED | 8795ac0d6e |
| 12 | 4 | WARNING | WebFileView.swift | BRANCH | VoiceOver readability | FIXED | plan evidence |
| 13 | 5 | WARNING | BoardLogic.swift | SELF | srcdoc/data frames | FIXED | ad7efd3963 |
| 14 | 5 | WARNING | WebFileView.swift | BRANCH | share thumbnail | FIXED | ad7efd3963 |
| 15 | 6 | WARNING | WebFileView.swift | SELF | UTF-16 odd cut | FIXED | c649108c15 |
| 16 | 6 | WARNING | WebFileView.swift | SELF | binary plist as text | FIXED | c649108c15 |
| 17 | 7 | WARNING | BoardLogic.swift shownText | SELF | cut inside emoji | FIXED | 1ce79f02b7 |
| 18 | 7 | CONVENTION | FilesView/RoomView | BRANCH | stale comments | FIXED | 1ce79f02b7 |
| 19 | 8 | CONVENTION | FilesLogic.swift | BRANCH | stale header | FIXED | 4b49958179 |
| 20 | 8 | WARNING | WebFileUITests.swift | BRANCH | sleeps, one hang | FOLLOW-UP | kosmos#8966 |
| 21 | 8 | WARNING | BoardClient.swift | BRANCH | relay header unmeasured | FOLLOW-UP | kosmos#8966 |
| 22 | 8 | WARNING | BoardLogic.swift | BRANCH | typed-with-params | FOLLOW-UP | kosmos#8966 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- MathML rendering is lost on purpose (renamed for safety); the HTML card's kind word reads "Text" (board parity).
- The sheet title is the saved name ("x.dat.html" for a page sent as "x.dat").
- No CSP meta as a fourth layer; the content rule is compiled on every open (a looked-up one could outlive a change).

### Strengths (across all iterations)
- Every safety claim was measured with a control arm: 40 connections without the rule, 0 with; a link tap's connection
  shown, then shown gone; the old rename list shown invisible to the UI test, so logic tests pin it.
- The sign-in-page defence rests on a positive signal (Content-Disposition: attachment) every board file route sends.
