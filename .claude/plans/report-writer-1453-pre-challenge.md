---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: report-writer-1453
diff_hash: afa27926fa11fb7a90fba85d6e9b0328f8110a339ca6b395f798d9ce7e99d94e
subdir_audit: passed
timestamp: 2026-08-29T00:50:32Z
---

## [PRE-CHALLENGE] Self-Check Results

### 🛑 DISCLOSURE FIRST: HOW THIS REVIEW WAS ACTUALLY RUN

**This was NOT a spawned fresh agent.** Both sanctioned paths, `/challenge-loop`
and `/pre-challenge`, require the Agent tool, which agents on this fleet are
instructed not to invoke. That deadlock is **#1404**, which I surfaced this
morning with finished work I could not open, and which Josh has since ruled on.

The resolution recorded on #1404 is a **cross-review by message**, needing no
tool, with the criterion that card found actually works: not *"review this
diff"*, which produces style notes, but **"find a surviving mutation: break a
line this branch defends and keep the suite green."**

**Reviewer: Ice Cream Kitty**, on a scratch copy sha-verified against my
worktree, blind to my findings, with anchor match counts printed before each
edit. Chosen because #1456 makes a claim about Codex and she scoped provider
support, so she was the person most able to tell me I was wrong.

⚠️ **So `method: pre-challenge` above is the closest value the hook accepts, and
it is not literally what ran.** The hash is real, the findings are real, and the
reviewer was genuinely independent. I am stating the difference here rather than
letting the frontmatter imply something untrue. **If that is not acceptable,
this branch should be held, and I would rather be told that than have it pass
quietly.**

Also noted for #1404: `subdir_audit: passed` is honest but trivial. This branch
changes no subdir CLAUDE.md.

### BLOCKERs

None. The reviewer's explicit ruling on the one candidate:

> **The live pass is NOT a blocker to SHIPPING, and IS a blocker to CLAIMING.**
> Before this branch, `auto` was absent on 100% of the Codex path, which you
> measured on the installed artifact with a control. The change cannot make that
> path worse, so holding it back keeps a proven-active defect in place to buy a
> verification that would not change the decision.

Adopted. #1456 carries the outstanding end-to-end pass on the card.

### WARNINGs

- **report-hook-auto-1453.test.js**: `seventh) report needs_you "x" ;;` SURVIVED.
  The separator class had no `)`, and **the hook is a `case` statement**: all six
  calls live in an arm, so an inline arm is the natural shape for a seventh
  event. Control same run: a plain call was caught. **FIXED** by adding `)`.
- **report-hook-auto-1453.test.js**: `report "$STATE" "x"` SURVIVED BOTH guards.
  `[a-z_]+` cannot match a variable, so the call was invisible to the matcher
  **and absent from the floor count**, which is the case the floor exists to make
  impossible. **A guard cannot count what it cannot parse. FIXED** by her tested
  assertion that a LOOSE count equals the STRICT count.

Both re-perturbed with her exact plants: inline case arm now turns both flag
tests red; the variable state now turns the loose-vs-strict test red. Restore
verified by sha.

### CONVENTIONs

- One em dash reached the plan file and seven reached the PR body. Both swept
  across five spellings with a planted-em-dash control proving the grep works.
  **FIXED**, zero remaining in the branch diff.

### NITs

- The LOOSE pattern can match prose containing a separator followed by
  `report <word>`. Comment lines are stripped, both counts read 6 today, and the
  failure message prints both counts so a false alarm is distinguishable from a
  real escape. Recorded in the file rather than left to be discovered.

### Attacked and CLEARED

- **`--auto` inert on non-idle states.** Measured, five states plus a control
  that refuses, then guarded, then perturbed by widening the rule to
  `idle || blocked` (red). I had asserted this in a commit message before
  measuring it.
- **The `by` predicate cannot disagree with the rule.** True, and the reviewer
  produced the sharper form: they cannot disagree **because they are the same
  expression**, so they can only be **wrong together**, which is worse, because a
  disagreement would be detectable. The chain is safe because `install/kosmos`
  emits a real JSON boolean and the route compares strictly, **not because of my
  tests**, which pass `auto: true` in JS and would never catch a serialization
  mismatch. Right answer, weaker reason.
- **#1456 itself.** She attacked the angle I had not: whether Codex agents
  already had #900's protection by another path. They cannot. The hook installs
  into Claude's hooks; Codex is wired through `notify` to the bridge. Two
  disjoint mechanisms, so the bridge was a Codex agent's only reporter.

### Verification

Full suite via `tools/run-tests.sh`, not a glob: **2901 tests, 2901 pass, 0 fail,
zero failure-shaped lines.** The runner's two globs cover all 264 test files on
disk. All ten new tests confirmed present in that run **by name**, against a
control name returning nothing.

Guards perturbed rather than merely run: hook guard on five arms, source changes
on five arms, each red, restore green and sha-verified after each.

---

### Strengths

- The card's own premise was checked before it was implemented, and it was
  wrong in the direction that would have shipped an authoritative-looking field
  that was incorrect five times out of six.
- The defect found on the way (#1456) was verified on the **installed artifact**
  rather than the repo, with a control, and its population established (five
  Codex agents) rather than assumed.
- Every guard added here was perturbed arm by arm, and the one that mattered
  most was still wrong twice before a second reader found the rest.

### What I would tell the next person

**Self-review did not converge on this branch.** I rewrote one guard twice and
it was still blind both times; I only found the first two holes because I had
written to a reviewer **naming where the guard was weakest**, and the last two
needed her. That is Renet Tilley's #1404 finding arriving again, and it is the
argument for the rota rather than for more rounds.
