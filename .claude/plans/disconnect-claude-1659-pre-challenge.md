---
pre_challenge: true
method: challenge-loop
branch: disconnect-claude-1659
diff_hash: 494de1125e88703cc347e5fb12414f5fd0b90ffc0e9faa720f7524927805cb28
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T14:01:40Z
iterations: 35
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 35
**Converged:** Yes, iteration 35 returned no findings it could substantiate
**Total findings:** 60+ (BLOCKERs, WARNINGs and CONVENTIONs; the count below is exact only
for iterations 27 to 35, which I held in full)
**Fixed:** all but one | **Deferred:** 1 | **Asked (awaiting user):** 0

Every iteration used a fresh agent with no knowledge of prior findings. I held the ledger;
no reviewer saw it.

### ⚠️ Disclosure about the ledger's completeness

**Iterations 18 to 22 were not fully blind.** My prompts told reviewers to read the plan
file, and that file had accumulated 309 lines of prior findings. I split the ledger out
when I noticed. Those five passes are recorded here as compromised rather than quietly
counted as clean.

**Iterations 1 to 26 are summarised, not itemised.** They predate a context compaction and
I do not hold their individual findings. I am not going to reconstruct a per-finding list
I cannot verify. What I can state precisely is the shape they established and the fixes
that survive in the diff.

### What the branch does

Activates the previously-disabled Disconnect button on Settings > AI models so a Claude
account can be disconnected. Removing renames the directory aside; nothing is deleted.

**It also fixes a live data-safety defect on main**, which is the reason it matters more
than a button: `forgetAccount` on the OpenAI route renames any `~/.codex-*` directory,
including one codex never wrote, and reports success. Measured on main with both arms and
a control, and this branch refuses it. That is kosmos#1718.

### The dominant defect class, found in nine separate iterations

**Guards that pass for a reason other than the one they name.** Reading never found one.
Perturbation found all of them:

| iter | the hole | what the suite said |
|---|---|---|
| 28 | a claim pin satisfied by the OTHER provider's copy of the sentence | green |
| 29 | an unanchored pattern matching any of 3 occurrences in the page | 909 pass |
| 29 | the OpenAI route clause pinned at NEITHER end | 3395 pass |
| 30 | a `disabled` regex missing the `disabled=""` spelling | 914 pass |
| 32 | a conditional pin matching inside its own negation | 34 pass |
| 32 | a window containing both the aria-label and the title, indistinguishable | 913 pass |
| 32 | a claim satisfied by a second occurrence in the same file | 913 pass |
| 33 | the same conditional pin defeated by SWAPPING THE TERNARY ARMS | 3401 pass |
| 34 | an adjacency window reaching BACKWARDS ACROSS A BRANCH BOUNDARY | 913 pass |

⭐ **The rule that came out of it, which is narrower than "write a control":**
a source pattern can always be satisfied by a different ARRANGEMENT of the same
characters. Perturb by writing a different legitimate FORM, not only by deleting. The
assertion that survived all of it is the one that renders the branch and reads what the
person is actually shown, which the Claude sibling had been doing from the start.

⚠️ **Five of those holes were in fixes I wrote one or two iterations earlier**, including
one case where my correction replaced a right number with one sampled from a headless
shell, and one where fixing a window made the guard correctly go red on the untouched tree
because it had been hiding a second thing.

### Per-Iteration Breakdown, 27 to 35

#### Iteration 27
4 findings: the "cancelled by every writer" claim false for the third time; a comment
promising a way out the engine does not offer; the OpenAI success sentence missing the
history consequence for its default; `configFile()`'s resolve fix uncovered. All FIXED.

#### Iteration 28
2 findings. `wasDefault` derived from a folder NAME while the real default honours
`CODEX_HOME`; measured both arms, the row the UI marks default disconnected reporting
false. FIXED, 4 arms added. Second: a tooltip/route claim pin that was vacuous. FIXED.

#### Iteration 29
5 findings, two of them guards that could not fail (above). Also a comment contradicting
the paragraph above it, an overclaim I had written, and a label announcing "(Claude)" on a
control that only appears on Claude rows. All FIXED.

#### Iteration 30
3 findings: the `disabled=""` regex hole; a tooltip parity gap where OpenAI carried none;
a citation dead in both trees. All FIXED.

#### Iteration 31
3 findings: an unconditional OpenAI tooltip that made the default read consequence-free
before the press; the repaint cancels unguarded; a misattributed mechanism in a
browser-check comment. All FIXED. The guard for the second took four attempts, each
failing differently, and is documented in the commit.

#### Iteration 32
5 findings, three of them vacuous guards I had written in the previous two iterations.
All FIXED, each perturbation-verified.

#### Iteration 33
2 findings: the conditional pin defeated by an arm swap, fixed by rendering the branch
rather than pattern-matching it, verified against four legitimate forms; and a setup.sh
comment contradicting one added 84 lines below. Both FIXED.

#### Iteration 34
3 findings: the adjacency window crossing a branch boundary; two assertions comparing only
a prefix of a sentence. All FIXED. Fixing the first exposed that the deferred timer write
correctly has no cancel, which the broken window had hidden.

#### Iteration 35
**No findings.** CONVERGED.

The reviewer fired 15 hostile inputs at the destructive path in a sandboxed home,
including traversal, three spellings of the default, a symlink, and non-account
name-shapes; every destructive case refused, the symlink moved the link not the target,
and a positive control confirmed a real account still removes. It perturbation-verified
two guards, walked all ten message writers by hand to confirm each window contains its own
branch's cancel, computed the contrast rather than eyeballing (4.82:1 at the shipped
opacity, against 4.5 needed), and ran the suite at 3513 pass, 0 fail, exit 0.

⭐ It also caught that HEAD moved under it mid-review (I merged main in), re-derived the
change set against the new merge base, and confirmed it byte-identical at 204,305 bytes
with `cmp`. That is a better handling of the stable-subject hazard than mine: I created it.

## Deferred

**`engine/accounts.js:118`** - the `configFile` arm covers one of two resolve fixes on that
function. Neither iteration 34's reviewer nor I could construct a reachable harm: under a
relative home the returned relative path resolves against the same cwd, and in production
`os.homedir()` is absolute. Recorded as measured rather than papered over.

## Verification at the landing sha

- suite: **3513 pass, 0 fail, REAL_EXIT=0** on the merged tree
- browser gate: re-run on this tree after the merge; the run log records the sha per run,
  because a gate result is a claim about a sha and mine was stale three separate times
- the branch was **114 commits behind main** when I went to land it, so both the earlier
  green suite and green gate were claims about a stale tree. Merged main in, zero
  conflicts, no overlap on my files, re-ran both.

## Honest notes

- **The worst defects arrived late.** Iterations 27 through 34 each found something real,
  and most of them were in the previous iteration's fix. A loop that had stopped at 10
  would have shipped five vacuous guards.
- **Three process failures produced false statements I had to retract**, each defeating
  the previous fix: a trailing command masking a failed edit, an edit chained with a slow
  check, and a helper printing "ok" before the write. The invariant is that a success
  message must be emitted by the thing that persisted, never by the thing that intended to.
- **I invalidated my own reviewer once** by merging main under it, which is the exact
  hazard I had written into the record earlier the same night.
