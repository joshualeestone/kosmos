---
pre_challenge: true
method: challenge-loop
branch: restore-dircheck-2615
diff_hash: 7c78073d5a06ba407f31d7cedbb236b18242f25ef191ad93dcfb25d2444d7779
timestamp: 2026-09-10T14:15:29Z
iterations: 7
converged: true
---

# Challenge-loop proof: restore-dircheck-2615 (kosmos#2615)

Greys out the removed-list **Restore** control when the agent's account folder is
gone. Frontend-and-backend counterpart to #2609 (PR #2613), which made the ENGINE
refuse that restore; the person was still offered a live button and told no
afterwards.

**Not frontend-only, and that was the first finding.** `GET /api/removed` returned
only `name`, `shownAs`, `removedAt`, `stopped`, and a browser cannot stat a
filesystem. One predicate is exported from `engine/remove.js` and read by BOTH
the engine refusal and the route, rather than a second copy of a four-line test,
because a pre-click state whose whole job is to agree with a post-click refusal
is the last place two implementations belong.

Full design record, every iteration's findings, the seams checked and found
clean, and the accepted residuals are in
`.claude/plans/restore-dircheck-2615-20260910T0932.md`.

## Iterations: 7, converged

| round | found | kind |
|---|---|---|
| 1 | a test passing on `false === false`; a WCAG failure in the first control | product + instrument |
| 2 | the explain handler destroying an in-flight restore status | product |
| 3 | **the card greyed nothing out** | product |
| 4 | the same live-region fix written in one direction only | product |
| 5 | a CSS comment that invented its own cascade | prose |
| 6 | a source-shape guard judging comments, in both directions | instrument |
| 7 | **NO NEW ISSUES** | converged |

The convergence signal is the PROGRESSION rather than round 7's zero: the product
surface stopped yielding after round 4, and rounds 5 and 6 found defects in the
prose and the instrument.

**The most repeated defect was never in the code.** Four findings were confident
claims about neighbouring code that was never re-opened, three of them in prose.
No test could have caught any of those, which is the argument for the blind round.

## Verification at convergence

- `bash tools/run-tests.sh`: **exit 0, 5610 tests, 5610 pass, 0 fail, 0 skipped.**
- `render-restore-dircheck-2615.js` under real Playwright: **exit 0.**
- Browser-check controls, all MEASURED against an isolated copy, never asserted:

  | mutation | result |
  |---|---|
  | baseline | exit 0 |
  | never-disable (reproduces `origin/main`) | exit 1, 8 problems |
  | always-disable | exit 1, 4 problems |
  | delete the `.acts .btn[aria-disabled="true"]` rule | exit 1, the two style arms |
  | widen that rule to every `.acts .btn` | exit 1, the style negative arm |
  | widen the explain selector to `.acts button` | exit 1, the live-control arm |
  | never press the removed-list toggle | exit 1, "would run against display:none" |
  | hard `disabled` instead of `aria-disabled` | exit 1, the WCAG arm plus three |
  | re-assert a held explanation unconditionally | exit 1, ONLY the staleness arm |

- Contrast measured across all four theme arms: light **9.36:1**, dark
  **10.58:1**, both `prefers-contrast` arms the same, blocked-vs-live distinct in
  every one. `.5` was rejected with numbers (**3.39:1, fails AA**) because this
  control is focusable and therefore not exempt.
- Keyboard reality measured: expanded, the control is focusable, on screen, in
  the tab order, and **both Enter and Space announce the reason**.
- Em dash sweep over every added line: **0**, with the pattern proven able to
  fire against a planted dash and to ignore a hyphen.

## Accepted residuals, stated rather than hidden

- The arrival clears the whole `#removed-msg` region, so an explanation on screen
  goes with it. The explanation is re-obtainable by pressing the control again.
- A stale-but-inert explanation if the folder returns with no further press.
  Nothing re-asserts it; inertness is not reprinting.
- **Pre-existing and verified as such, not introduced here:** other
  `#removed-msg` writers that clobber each other (including the restore handler's
  `partial` branch), and the single-slot `RESTORE_WAITING` losing the first of two
  concurrent in-flight restores.
- **#2609's named, still-open follow-up:** a Windows agent whose account was
  deleted restores unchecked. The greyed state is deliberately no wider than what
  the engine actually refuses.

## Review output, per iteration

#### Iteration 1 (opus): 1 BLOCKER, 2 WARNING, 1 CONVENTION, 3 NIT

[BLOCKER] The route's one new production line was unasserted for the `true` case. The agreement arm compared `row.accountFolderGone` against the predicate on a fixture whose plist body is `<plist/>`, so `readJob` returned null and BOTH sides were `false`. Measured: a hardcoded `accountFolderGone: false` passed it. Nothing else covered it (the browser check stubs `/api/removed`; the engine arms call the predicate directly), so the card could have silently stopped shipping with a green suite. Fixed: a new arm builds a real plist naming a real account dir, asserts false while it exists, deletes it, asserts true. Discriminating control against the same mutant: the new arm fails, the old one still passes.

[WARNING] The control used hard `disabled` with the reason in a `title` plus `aria-label`, citing the sibling reauth control as precedent. The sibling argues the opposite at its own code: a `disabled` button leaves the tab order (the repo names non-focusable controls a WCAG AA failure) and a `title` on a disabled control is not announced at all. The first version put the ONLY explanation out of reach of exactly the people it was written for. Fixed: `aria-disabled`, focusable, refusal enforced structurally by the absence of `data-restore`, plus a handler so a press says why.

[WARNING] Both "cannot drift" assertions were tautologies, comparing values the preceding asserts had already pinned to true. Fixed: each state is measured independently, then the pair compared.

[CONVENTION] The plan's diagram named `restoreBlockedReason`; the code ships `restoreBlockedByMissingAccountDir`. Fixed, because the name a future reader greps for must be the one in the tree.

[NIT] Nothing pinned that `restore()` READS the export: a re-inlined byte-identical copy left every behavioural arm green, because two copies agree perfectly on the day the copy is written. Fixed with a source-shape arm, labelled as the weaker instrument it is.

[NIT] Scope bullets stated only in prose. Fixed: each of #2609's scope bullets is now an assertion (`configDir: null` not blocked, win32 not blocked, gone plist not blocked).

[NIT] Self-disclosed: the first version of the accessibility fix declared the reason sentence inside `paintRemoved` while binding the handler at module scope, so a press would have thrown `ReferenceError`. Caught before commit by checking the scope rather than assuming it.

#### Iteration 2 (sonnet): 0 BLOCKER, 1 WARNING, 1 NIT

[WARNING] `#removed-msg` is a single assertive live region shared by several flows, and this card added another writer without checking. The in-flight sentence is written ONCE and cleared only by the ARRIVAL it predicts, so anything overwriting it destroys it permanently: press Restore on one row, then an unavailable Restore on another, and the first agent is still coming up with nothing on screen saying so. Fixed: both sentences are true at once, so both are said, with the in-flight one RE-ASSERTED from the variable that holds it.

[NIT] The browser check searched `.acts button` by `data-shown-as`, and the "Delete its files" button in the same row carries the SAME attribute, so it silently depended on Restore rendering before Delete. Fixed: scoped to the union of the two Restore attributes.

[STRENGTH] This round independently mutation-tested every iteration-1 fix and confirmed they hold.

#### Iteration 3: 1 BLOCKER, 1 NIT

[BLOCKER] The "unavailable" Restore was VISUALLY IDENTICAL to a live one. Measured by getComputedStyle through the real `paintRemoved`: blocked and live identical on opacity (1), cursor (pointer), background, colour and border. The card is titled "grey out the control" and it greyed nothing out. Mechanism: `disabled` was doing TWO jobs, semantics AND the `.btn:disabled` dimming; the iteration-1 move to `aria-disabled` preserved the first and silently dropped the second, and no `.btn[aria-disabled="true"]` rule existed. Nothing in the suite could see it because every arm asserted an attribute. Fixed with a scoped CSS rule plus computed-style arms; `.8` not `.5`, decided by contrast measurement.

[NIT] The README row for the browser check said it "asserts the blocked row's button is `disabled`". The check REDS on hard `disabled`. Fixed.

#### Iteration 4: 1 BLOCKER (independent duplicate), 1 WARNING

[BLOCKER] Independently found the same visual-identity defect as iteration 3, with its own getComputedStyle measurement. Recorded because two blind agents converging on one defect is evidence about the defect, not noise.

[WARNING] The shared-region fix was written in ONE DIRECTION. Iteration 2 stopped the explain handler destroying an in-flight status; nothing stopped the reverse. Measured: press an unavailable Restore, read why, then press a WORKING Restore on another row, and the explanation is fully erased, not merged. Fixed symmetrically with a companion held-sentence variable.

#### Iteration 5: 0 BLOCKER, 0 WARNING, 1 NIT

[NIT] The "scoped to `.acts` deliberately" CSS comment misstated the cascade it claimed to defend against, saying an unscoped rule would tie `.btn:disabled` on specificity, win on source order, and restyle `#fr-next` from .5 to .8. Measured false on both arms: `#fr-next` renders at .45 from `#firstrun #fr-next[disabled]` (an ID rule, 2,1,0), and the hypothetical rule injected LAST so source order would favour it still leaves it .45. `#fr-next` is also not inside `.acts`. Fixed: the comment now gives the true reason (blast radius) and records the correction, because this was the fourth confident claim on this card about code never re-opened.

#### Iteration 6: 0 BLOCKER, 1 WARNING

[WARNING] The source-shape guard scanned the full text of `restoreInner`, comments included, so a purely cosmetic comment edit could flip it red on unchanged behaviour. Verified, and sharper than reported: the only `readJob(` left in that function is inside a prose comment (0 occurrences in code), so that arm was anchored ENTIRELY on prose. The reviewer named the safe direction; the dangerous one was open too, since the `match` arm reads the same raw text and a comment naming the export would satisfy it while the code beneath inlined a copy. Fixed using `codeOnly`, the repo's shared both-directions-tested stripper, rather than a local regex (which would have been the exact defect that test exists to prevent). Five arms measured, including an inlined copy PLUS a comment naming the export, which is still caught.

#### Iteration 7: No issues found

No issues found. The round traced the state machine across all four write sites and mutation-tested PRODUCT code rather than the test's own bookkeeping: dropping the `stillBlocked` DOM check to `!!RESTORE_BLOCKED_SAID` reds the `staleReasserted` arm with the expected message.

[STRENGTH] It raised two residuals and both were judged rather than waved past: a stale-but-inert explanation (accepted, nothing re-asserts a false claim), and two concurrent in-flight restores losing the first one's status (verified pre-existing against `origin/main` rather than taken on the reviewer's word).

### Final Ledger

7 iterations, converged. 3 BLOCKER (one an independent duplicate), 5 WARNING, 1 CONVENTION, 6 NIT, 2 STRENGTH. All findings addressed or explicitly accepted with reasons above. Product-affecting defects were found in rounds 1 through 4; rounds 5 and 6 found defects only in prose and instrumentation; round 7 found nothing. Suite at convergence: exit 0, 5610 tests, 5610 pass, 0 fail, 0 skipped. Browser check exit 0 under real Playwright with nine measured mutation controls.
