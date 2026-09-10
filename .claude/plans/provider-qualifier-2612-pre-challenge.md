---
method: challenge-loop
branch: provider-qualifier-2612
diff_hash: 858e4b51faf3e3c323055090b4c9e4f98d523b3acc697c3416c66d9ebf4a2d41
timestamp: 2026-09-10T09:24:54Z
iterations: 12
---

# Challenge-loop proof: provider-qualifier-2612 (kosmos#2612)

Twelve iterations, alternating opus and sonnet, each a fresh blind agent. Converged on
iteration 12 with **zero findings**. Eleven of the twelve found something real.

## Iteration record

| # | model | findings |
|---|---|---|
| 1 | opus | 1 BLOCKER, 5 WARNING, 4 NIT |
| 2 | sonnet | 1 CONVENTION |
| 3 | opus | 4 WARNING, 1 CONVENTION, 1 NIT |
| 4 | sonnet | 1 BLOCKER, 1 CONVENTION, 2 NIT |
| 5 | opus | 1 WARNING, 6 NIT |
| 6 | sonnet | 1 WARNING, 1 NIT |
| 7 | opus | 6 WARNING, 1 CONVENTION, 3 NIT |
| 8 | sonnet | 1 WARNING (uncommitted work in tree; NOT a clean round) |
| 9 | opus | **1 BLOCKER**, 2 WARNING |
| 10 | sonnet | 1 CONVENTION, 1 NIT |
| 11 | opus | 2 WARNING, 1 NIT |
| 12 | sonnet | **none** |

Iteration 8 is not counted as a clean round: it reviewed a tree holding uncommitted work and
correctly flagged exactly that.

## The defects that mattered

**Iteration 9 found the original bug still shipping.** The grouping key was
`name || email || keyTail` while the screen renders
`name || email || keyTail || label || dir`. The key was a strict PREFIX of what each row shows, so
any account identified only by its label keyed to '', was never counted ambiguous, and got no
qualifier: two rows both read "Sign in again as work". Reachability read in the engine rather than
assumed. The key now READS `acctPrimaryName` instead of carrying a stale copy of its chain.

**Case-sensitivity was found FIVE times, each where the previous four fixes had not looked:** the
label branch, the reserved word `main`, the provider id in the group set, the provider id at the
ternary, the grouping key itself, and finally `dir` (collision-proof as a STRING, not as a SOUND).

**Duplicated facts drifted five times:** two provider-id derivations, the key vs `acctPrimaryName`,
the cross-derivation pin's membership list, and three test files each carrying their own copy of the
page-extraction harness.

**Comment defects were the dominant class, eight of them**, and iteration 11's verdict is the
finding worth carrying forward:

> "Ten rounds have not trained a blind spot into the CODE. They have trained one into the PROSE."

## Evidence

- **46 arms** in `web.account-qualifier.test.js`.
- **Full suite `bash tools/run-tests.sh` rc=0: 5604 tests, 5604 pass, 0 fail, 0 skipped**, run after
  merging origin/main.
- **Browser check green under real Playwright**, and still REDS against origin/main's page with the
  two problems its header states, so it has not been disarmed by any edit to it.
- **Mutation battery, 7 single-point mutations, all 7 caught** post-merge, verified with no residue.
  Each mutation asserts its target is present exactly once before substituting, so a mutation that
  fails to apply cannot masquerade as one the tests caught.
- **Collision sweep: 0 audible collisions across 62,208 two-row fixtures** including case-variant
  dirs, with controls at 164 and 1760 proving the sweep can return the dangerous answer.
- **Iteration 11 independently ran 13 mutations (12 red, the 13th documented-unpinnable) and
  2,075,040 brute-forced row-pairs** over a 1,440-row pool against an oracle it proved live.

## Known limits, stated rather than glossed

- **One mutation is unpinnable and is labelled so at the code:** `takenAlready('main')` vs
  `used.has('main')`. Measured genuinely unobservable (0 differences across 110,592 output
  comparisons and 64,000 collision checks); the two `main` guards each cover the other's
  single-revert path. A redundant guard honestly labelled beats a vacuous arm claiming to hold it.
- **`distinctly()` cannot separate two rows sharing a `dir`**, and nothing inside this function
  can: the returned Map is keyed on `dir` and all three callers look it up by `dir`, so the return
  shape cannot express two answers for one dir. Stated at the code.
- **A brute-force sweep proving "no two sound alike" does not prove "every qualifier is useful."**
  Those are different properties, and the #1917 harm class (distinct but meaningless) is invisible
  to the collision oracle. It was hunted specifically in iteration 12 and caught by suite arms.
- **Nobody has used this on a running board.** It is code plus tests; that is a release step.
- **Josh has not seen the words "Claude" / "OpenAI" as qualifiers.** One line to change, and the arms
  pin the values so a change fails loudly rather than drifting.

## Merge state

origin/main merged in at 25 commits ahead / 0 behind. `accountQualifiers` proven **byte-identical
across the merge** (function body extracted from both sides and compared), so the merge cannot have
altered the reviewed behaviour.

## Review output, per iteration

#### Iteration 1 (opus)
- [BLOCKER] exact-string membership let a label `openai` sit beside the new qualifier `OpenAI`, which a screen reader announces identically. This was a REGRESSION: pre-change those rows were audibly distinct.
- [WARNING] the fixture used `label: 'OpenAI'`, a shape `list()` can never produce, so it pinned a guard that can never fire while the reachable variant went untested.
- [WARNING] four comments around the change still described the old two-step chain.
- [NIT] the plan understated its own coverage (four new arms claimed, nine present).

#### Iteration 2 (sonnet)
- [CONVENTION] commit subject shape.

#### Iteration 3 (opus)
- [WARNING] a trade accepted for ONE surface was applied to THREE: the plan reasoned about the Settings box while the change also hit two pickers where a provider name identifies nothing.
- [CONVENTION] the scoping needed stating at the code, not only in the plan.
- [NIT] stale wording in the chain comment.

#### Iteration 4 (sonnet)
- [BLOCKER] the reserved word `main` was still compared exact-case. Reproduced `["Main","main"]`: two strings, ONE sound.
- [CONVENTION] the comment claiming "nothing can put a case-variant of `main` into `used`" was false, and was itself an instance of the class it warned about.
- [NIT] fixture shape.

#### Iteration 5 (opus)
- [WARNING] the plan asserted a downside that the scoping added in iteration 3 makes impossible.
- [NIT] scoping rationale argued a different property from the one the code tests.
- [NIT] `providersHere` rebuilt per row with a full `rows.filter()` while its sibling fact was precomputed in one pass.
- [NIT] the browser check's slash test ran against the whole aria-label, not the qualifier.
- [NIT] the provider ternary carried no `#2634` pointer at the code.
- [STRENGTH] swept 25,600 fixture combinations against a mutant reverting membership to an exact `Set.has`: 0 audible collisions on the branch versus 1,025 on the mutant.

#### Iteration 6 (sonnet)
- [WARNING] a test named as "the mirror" was a byte-for-byte DUPLICATE of an earlier arm; the combined case its comment described was exercised by nothing.
- [NIT] the provider id was compared exact-string while every other membership test in the same function had been made case-insensitive. Reproduced: `["main","work","Claude"]` versus a control of `["main","work","/Users/x/.claude-work"]`.

#### Iteration 7 (opus)
- [WARNING] the empty-string provider inflated the group's provider set exactly as a case-variant did; iteration 6 closed the CASE arm and left the MISSING arm open.
- [WARNING] `provId`'s lowercasing was unpinned: reverting it left all 37 arms green, because the case-variant fixture was all-Anthropic so the ternary was never reached.
- [WARNING] the comment cited `server.js:4696` as a source of account-row providers; it is a 400 error body, the same category the next sentence disqualifies for `:4739`.
- [WARNING] the comment claimed a label "can never BE OpenAI"; `engine/openaiaccounts.js:166` reads the basename with no normalisation, so `~/.codex-OpenAI` yields `"OpenAI"`.
- [WARNING] the cross-derivation pin's own name miscounted the sites it pinned, leaving one unmatched.
- [WARNING] the browser check header claimed "REDS on origin/main (both labels identical)"; measured, it reds as `(main)` versus `(/home/.codex)`.
- [CONVENTION] 235 comment lines to 49 code lines (4.8:1), mostly review archaeology.
- [NIT] the qualifier extraction took the LAST parenthetical, and `who` is arbitrary user text.
- [NIT] the plan carried the head-vs-no-head justification the code retracts.

#### Iteration 8 (sonnet)
- [WARNING] the worktree held uncommitted changes not in the reviewed diff. NOT counted as a clean round; the review was against a stale tree.

#### Iteration 9 (opus)
- [BLOCKER] the grouping key was a strict PREFIX of `acctPrimaryName`, so a row identified only by its label keyed to '' and got NO qualifier. Measured `["", ""]` against a control of `["work", "OpenAI"]`. The original #2584 bug, shipping.
- [WARNING] `dir` never cleared the used-set and was called "the collision-proof last resort": true of STRINGS, false of SOUNDS. Measured 1 distinct sound from 2 dirs.
- [WARNING] the pin's count had been corrected in the WRONG direction: three short-pair producers, not four.

#### Iteration 10 (sonnet)
- [CONVENTION] a stale claim in `web.acct-picker-1917.test.js`, a file the diff never touched, which kept passing because nothing depended on it being true.
- [NIT] `distinctly('')` returned '', the one value an ambiguous row must never receive.

#### Iteration 11 (opus)
- [WARNING] the `provIdOf` banner claimed three call sites including the key; there are two. It concealed the last exact-case provider read in the qualifier path.
- [WARNING] iteration 10's empty-dir guard covers HALF the fix it was written for while reading complete: the returned Map is keyed on `dir`, so two rows sharing a dir read the SAME entry and the guard's value cannot reach the caller.
- [NIT] `const dir = String(a.dir || '')` had no `a &&` guard, alone among the function's reads, so a null row threw.
- [STRENGTH] 13 mutations, 12 red the suite; 2,075,040 brute-forced row-pairs over a 1,440-row pool against an oracle proven live; every cross-file citation opened and checked.

#### Iteration 12 (sonnet)
No issues found.
- [STRENGTH] comment-accuracy sweep: every substantive claim checked against the code as it stands, including the three call sites and their filters, the three short-pair derivations, and the cross-file citations in `server.js` and `engine/openaiaccounts.js`.
- [STRENGTH] hunted the #1917 "distinct but meaningless" harm class specifically, which the collision oracle is blind to: a provider tag is only assigned when `providersHere.size > 1` for that row's own key-group, computed from the same `rows` array the call site renders, so it cannot fire on a group that is not cross-provider from that screen's point of view. No meaningless-tag case found.
- Note: the one full-suite failure it saw (`server.test.js` #338) was port contention from a live board holding :16180, not a regression. Confirmed by re-running `server.test.js` alone: 261/261 pass.

### Final Ledger

Converged on iteration 12 with zero findings. Eleven of twelve iterations found something real, so the loop was not stopped on falling yield: iteration 9 produced a BLOCKER after two comparatively quiet rounds, and iteration 11 produced two WARNINGs immediately after iteration 10 came back nearly clean.

All findings above are either fixed on this branch or recorded at the code with the reasoning and the measurement. The known limits are listed in the section above and are not claimed as resolved.
