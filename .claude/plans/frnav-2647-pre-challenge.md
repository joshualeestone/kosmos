---
pre_challenge: true
method: challenge-loop
branch: frnav-2647
diff_hash: 8e67c3f88910a8ffb0d60d606dc7c802f8463d7dd891041001917967ffa6e152
timestamp: 2026-09-10T16:47:37Z
iterations: 5
converged: true
---

# Challenge-loop proof: frnav-2647 (kosmos#2647)

Josh, product review 2026-09-10: on the first-run energy/accessibility screen he
**could not see the helper copy at all before finishing the connection.** The old
block rendered perfectly and simply sat below the fold, so the fix is WHERE the
control is, not what it says.

Four changes as specified: his exact top copy; the "this can take a few seconds"
line deleted; **Check again** moved into the bottom nav (far left, beside Next);
its copy shortened to "Turned it on? Tap to check." and moved with it.

Full design record and every iteration's findings:
`.claude/plans/frnav-2647-20260910.md`.

## 🛑 The obvious implementation is a DEAD BUTTON that looks entirely correct

`.fr-acts` already has a far-left secondary slot (`#fr-alt`), so the tempting
move is to hand it the existing `fr-recheck` class. **That handler is delegated
on `#fr-pane-3`, and `#fr-alt` lives OUTSIDE every pane**, so the click would
never arrive: a control that renders, styles, focuses and silently does nothing.
Every placement arm passes on it. Wired through `frActions`' `alt.go` instead,
and **the check's load-bearing arm is the PRESS, not the placement.**

## Iterations: 5, converged

| round | found | kind |
|---|---|---|
| 1 | a stale wired check aimed at the moved control; a one-shot button; no aria tie; a vacuous adjacency arm; a false CSS comment; a backwards wrap note; no generation guard | product + instrument + prose |
| 2 | the new guard covering one line of two | product |
| 3 | the same defect independently, plus the count assertion's brittleness | corroboration |
| 4 | the guard could not see the OTHER guard on the same shared button | product |
| 5 | **NO NEW ISSUES** | converged |

⭐ **The feature was correct from the first commit.** Every round since was about
the instruments and the prose around it.

## Verification at convergence

- `bash tools/run-tests.sh`: **exit 0, 5763 tests, 5763 pass, 0 fail, 0 skipped**, re-measured
  AFTER a rebase onto `origin/main` (which had moved 21 commits and added 33 tests). The
  pre-rebase run is orphaned and deliberately not cited: a rebase rewrites the shas every
  recorded run was measured against, and a results table does not change appearance when that
  happens. Both conflicts were the browser-check wiring again; the runner loop was resolved as a
  union computed token-wise (86 from main, including this author's own check from the merged
  #2615, plus this one) and the two counters by applying this card's CONTRIBUTION (+2 each) to
  main's new baseline, confirmed by RUNNING that test rather than by arithmetic.
  carried through to the SHELL gates rather than stopped at the node tally.
  Browser-check surface gate and bc-surface-map both **0 FAILED**.
- `render-frnav-2647.js` under real Playwright: **exit 0.**
- Browser-check controls, all measured against an isolated copy:

  | mutation | result |
  |---|---|
  | baseline | exit 0 |
  | `alt.go` replaced with a no-op (the dead button) | exit 1, ONLY the press arm, every visual arm still passing |
  | drop the re-enable in `frRecheckPress` | exit 1, the one-shot arm |
  | never SET the aria tie | exit 1, the describedby arm |
  | never CLEAR the aria tie | exit 1, the stale-tie arm |
  | move the hint span after `.fr-spacer` | exit 1, the adjacency arm, gap named |
  | drop the hint-clear calls | exit 1, the leak arm |
  | restore the old top copy | exit 1, the copy arm |
  | never press the list toggle | exit 1, "would run against display:none" |

- Guard behaviour measured directly, not asserted: a throwing press, two presses,
  a mid-flight repaint, a return to step 3, and the cross-consumer case (a stale
  step-3 press must not hand back a button step 5 is holding).
- Layout measured at 1200/900/600/420: control left of Next, no overflow, hint
  never clipped, gap a constant **14px** (so the 24px adjacency bound is a real
  limit). Geometry byte-identical with and without `margin-right: auto`.
- Accessibility measured on the real page: focusable, on screen, in the tab
  order, **Enter and Space both activate**, contrast 8.24:1, and the hint tied by
  `aria-describedby` (toggled both ways).
- Em dash sweep over every added line: **0**, all spellings, with a passing
  control.

## Residuals, stated rather than hidden

- The sibling `frRecheck` shares the ASYMMETRY (its message clear sits outside
  its own token) but **not the SHAPE**: it is on the success path inside the
  `try`, behind a step check, not in a `finally`. Pre-existing, another screen,
  and different enough that "fix it the same way" would be wrong. Left alone
  deliberately.
- Two other handlers write `#fr-s3-msg` concurrently with a re-check. Pre-existing
  and unchanged by this card, confirmed independently in round 5.
- Adding the hint makes step 3's nav wrap below roughly **490px** viewport, where
  `origin/main` did not wrap down to 400px. Cosmetic, real, and previously
  unstated.

## Review output, per iteration

#### Iteration 1: 1 BLOCKER, 3 WARNING, 1 CONVENTION, 2 NIT

[BLOCKER] `docs/browser-checks/render-gated-next.js:346` still targeted `#fr-pane-3 .fr-recheck`, the selector this card deleted. Verified: zero markup hits on the shipped page, controlled against the two COMMENT hits the same grep returns, and it is wired at `tools/browser-checks.sh:1114`. Worse than a plain red: `ok(!!btn)` fails, the label arm then compares against `''`, and `if (btn) await btn.click()` silently NO-OPS, turning the arm below it into a coin flip on whether a 750ms poll tick lands in its 80ms window. A moved control degraded a sibling check into FLAKINESS rather than an honest failure. Repointed to `#fr-alt` with a visibility assertion, keeping the live-board integration signal the new hermetic check cannot provide.

[WARNING] The new browser check passed green on a ONE-SHOT button: it clicked once and never looked at `disabled` again, though "flip the switch, press again" is the control's entire purpose. Arm added; control reds.

[WARNING] The move COST the control its adjacency. The hint used to sit inside pane 3 directly under the gate rows it refers to; it now lives in a footer shared by nine screens, where a rotor or tab lands on a button whose whole accessible name is "Check again". `aria-describedby` now ties them, toggled BOTH ways (left on, it would point a hintless screen's button at an empty hidden span).

[WARNING] `hintBesideAlt` was VACUOUS, admitting any position in the ~350px between the two buttons. Measured: the span moved after `.fr-spacer` drifts 99px off its own button, wedges toward Next where it reads as a caption for the wrong control, and every arm still passed. Tightened to a measured 24px bound.

[CONVENTION] The new CSS comment claimed `margin-right: auto` was load-bearing. MEASURED FALSE: geometry byte-identical with and without it at five widths. The mechanism is the span's DOM position before `.fr-spacer`. A wrong comment and a weak assertion pointing the same way is how a defect walks through both: the change the comment licensed was exactly the one the check passed on.

[NIT] The same comment's wrap note was backwards (at 460px the hint stays on its row and NEXT wraps). Corrected, with the real ~490px wrap threshold recorded.

[NIT] `frRecheckPress` re-enabled a nine-screen shared button with no generation guard, while its sibling `frRecheck` guards the SAME element with exactly that pattern. Added.

#### Iteration 2: No issues found on the code, then 1 NIT on the fix

[STRENGTH] Independently reproduced the mutation arms rather than taking them on trust, and swept all ~25 `frActions` call sites for hint regressions.

[NIT] The new token guard protected `btn.disabled = false` but NOT the adjacent message clear one line above. A stale press still blanked "Checking…" while a NEWER press was in flight and still correctly holding the button disabled. Measured: `msg ""` with `disabled true`. A half-guarded `finally` READS as guarded, which is why the uncovered line was the one nobody re-read.

#### Iteration 3: 1 WARNING, 1 CONVENTION

[WARNING] Independently found the SAME half-guard defect at the committed sha while it was being fixed. Recorded rather than deduped: agreement between independent blind agents is evidence about the defect.

[CONVENTION] The `assert.equal(count, 2)` added to fix a vacuous substring test was itself brittle the other way, counting over source INCLUDING comments. Measured: one added comment mentioning `fr-msg-err` takes the count 2 to 3 and reds a BEHAVIOUR assertion on a documentation edit. Now taken over `codeOnly`, the shared both-directions-tested stripper. Third assertion on this work to judge prose rather than code.

#### Iteration 4: 1 WARNING

[WARNING] `FR_RECHECK_PRESS` could not see `frRecheck`'s separate `FR_CHECKING` token on the SAME shared `#fr-alt`. Reported as reasoned; measured before acting and confirmed: a stale step-3 press passes its own token check and hands back a button step 5 is deliberately holding (`disabled` false where it should stay true). Both guards were individually correct and the pair was not: each asks "is there a newer request of MY kind". Now also keyed on `FR_GATE_SCREEN`, chosen over a step number because this file ships a lib about not hardcoding step indices.

#### Iteration 5: No issues found

No issues found.

[STRENGTH] Ran the browser check FOR REAL and confirmed Playwright was present rather than silently skipped, and independently established the ordering fact the new guard depends on: `frGateStop()` runs BEFORE `FR_STEP` is reassigned, so a stale press cannot slip through on half-updated state. Also confirmed the other `#fr-s3-msg` writers predate this card.

[NIT] Offered one ungraded observation, that `max-width: 22ch` against a 27-character hint might wrap the span. MEASURED AND FALSE: one line at 1200/900/600/460, 162px rendered against a 180px max-width, because `ch` is the width of the "0" glyph rather than an average character.

#### Self-found, between rounds

[CONVENTION] A note calling `frRecheck`'s message-clear an "identical shape" to the one just fixed. It is not: that clear sits on the success path inside the `try`, behind a step check, with only the token-guarded line in its `finally`. They share the asymmetry, not the shape. Corrected, because the note's job was to stop somebody "fixing it the same way" later, and a vague pointer at a real problem is worse than none: it gets acted on.

[NIT] Four of this card's own measurements were not-evidence that looked like evidence: two mutations whose anchors never matched (so the "mutant" run was the baseline and reported a clean pass), one that broke the page so the check failed on a syntax error rather than on the arm, and one control that could not discriminate, which nearly shipped a guard that could not be demonstrated. Two were caught ONLY because the control and the mutant printed identical output.

### Final Ledger

5 iterations, converged. 1 BLOCKER, 5 WARNING, 3 CONVENTION, 5 NIT, 2 STRENGTH. All addressed or explicitly accepted with reasons above. The FEATURE was correct from the first commit; every round after found defects in the instruments and the prose around it. Six claims about neighbouring code did not survive being re-opened, five caught by reviewers and one by reading a sentence back. Suite at convergence, re-measured after the rebase: exit 0, 5763 tests, 5763 pass, 0 fail, 0 skipped, both shell gates 0 FAILED. Browser check exit 0 under real Playwright with nine measured mutation controls.
