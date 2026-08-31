---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: zshpath-1621
diff_hash: 7692d09d1e8bb62e46b0485f27d03bf0201ee1ca72d5b7698c361d3d76540316
subdir_audit: passed
timestamp: 2026-08-30T23:11:01Z
converged: true
---

## [PRE-CHALLENGE] Single-pass self-review

One pair of eyes, mine. `explicit_override: true` rather than relabelling this
`challenge-loop`, which would be false.

✅ **And unlike my three earlier proofs today, this `diff_hash` binds EXACTLY the change: 5
files hashed, 5 files changed.** The earlier ones bound 25, 33 and 36 for changes of 3, 8 and
3, because the local `main` was 22 commits behind. I fast-forwarded it (reasoning on #1472),
and this is the first proof on this machine that certifies only its own diff.

## [BLOCKER] (mine) My guard failed on its own documentation

A detector has to spell what it detects, so `path`, `cdpath` and the planted fixture all
appear in `tools/test-zsh-tied-names.sh`. Run against the whole tree it reported **five
offenders in its own prose and code and went red on a clean tree** - a false alarm of exactly
the kind that trains people to ignore a guard --> FIXED two ways: full-line comments are
stripped before matching (so any lib DOCUMENTING the hazard is not read as committing it),
and the file excludes itself. **The exclusion's cost is written into the file** rather than
left for a reader to discover.

## [BLOCKER] (mine) My first cut check was name-keyed, and its control tested a different tool

Splinter challenged this mid-task and he was right. I had run
`ps -Ao ... | grep 'releas[e]\.sh'` and called it clear. Two faults: it keys on a **name
somebody else controls** (the fleet has been renaming processes, so one rename makes it
blind), and **my control used `pgrep` while the subject used `ps | grep`**, so the control
never validated the instrument I actually ran --> FIXED: re-checked with the repo's own
`tools/lib/cut-guard.sh`, which is purpose-built and has its own test file. All arms:

```
real, no probe                       rc=0   no cut running
KOSMOS_CUT_PROBE reports a cut       rc=1   it CAN refuse
probe exits 3                        rc=1   cannot-answer is a refusal, not a pass
browser-run guard                    rc=0
```

⭐ **The generalisable half: a control that exercises a different tool from the subject proves
nothing about the subject.** Nothing had been edited when this was caught.

## [WARNING] (mine) My first sweep pattern could not see the primary site

I swept for `(^|[^a-zA-Z_])path=` and found 2 sites. **The site the cards are actually about
is a BARE `path` in a `local` list with no `=` at all**, and this card's own headline says
the declaration alone is enough --> FIXED: a second pattern for bare names in
`local`/`declare`/`typeset` lists. Together they find exactly the three sites the cards name.

⇒ **An assignment-keyed pattern is blind to a declaration**, which is the same class as the
anchored-grep trap the cards warn about, one layer along.

## [STRENGTH] The guard has behavioural arms, and each is paired with a control

A sweep proves the string is gone; it does not prove the hazard is. So the test sources the
FIXED lib into a real `zsh -f`, calls the function and asserts `mktemp` is still findable -
**paired with a control that runs the OLD shape in the same zsh and asserts PATH is still
destroyed.** Without that control, `SURVIVED` is equally consistent with a check that never
exercised the hazard.

Likewise the grep arms: the anchored pattern MUST fail on a planted offender, so the file
proves the trap rather than asserting it.

⚠️ **Named limit:** the behavioural arms `SKIP` where zsh is absent, so a green on such a
machine is weaker. It says so in its own output.

## [STRENGTH] Wired into something that runs it

`package.json`'s `test:shell`. Confirmed by running `yarn -s test:shell` and seeing the
guard's ten lines in its output, and again in the full `npm test`.

## Verification

| perturbation | result |
|---|---|
| bare `path` declaration restored in site-deploy.sh | **RED**, on the `path` arm only |
| unperturbed | green, 0 failures |

`tools/lib/site-deploy.sh` restored to its exact sha afterwards, checked.

The two libs' own existing tests: `test-disk-guard.sh`, `test-site-deploy-export.sh` and
`test-site-restore-1548.sh` all rc=0, 0 failures. The disk guard still answers correctly when
executed under bash.

Full suite: **3213 tests, 3213 pass, 0 fail**, `SUITE rc=0`, with the shell guard running
inside it.
