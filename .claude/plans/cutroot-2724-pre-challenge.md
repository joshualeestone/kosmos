---
method: challenge-loop
branch: cutroot-2724
timestamp: 2026-09-11T04:01:01Z
diff_hash: d3dd7b4c8b32cb5e20b6fa28367213c826ba22f4011b7165ec253d4f12e297cc
---

# Pre-challenge proof: `cutroot-2724` (kosmos#2724)

**Method detail:** blind adversarial challenge loop, 2 rounds, a fresh reviewer each round, converged.

Two rounds, a fresh blind reviewer each time, each given the diff, the plan, and a
priority-ordered list of attack surfaces including the questions I most wanted answered
about my own work. Every finding below was **re-derived by me before I acted on it**;
where I disagreed I said so, and where the reviewer was right I said that too.

#### Iteration 1

**Returned: 1 BLOCKER, 4 WARNINGs, 2 NITs.**

**[BLOCKER] The change would have aborted the first cut that ran it.**

`tools.cut-home-2724.test.js` built its child environment from `...process.env` and never
cleared `AGENT_WORKFORCE_HOME`. Step 3 of `release.sh` runs `yarn test` **with that
variable exported**, so on a real cut the file inherits it; the opt-out arm (which asserts
the child saw `<unset>`) reds; the #2006 isolation rerun reproduces it under the same
exported env, so it is graded a *real red*; and the cut aborts at step 3.

Measured before the fix: `6/6` with no ambient value, `5/6` with one.

⭐ **The method that found it transfers, and it is the part worth keeping.** My results
table had an arm at 5930 tests (the count *without* the new file) and an arm at 5936 (the
count *without* an ambient home). **The two variables were never set at the same time, so
the one combination that describes a real cut was the one combination never measured.** A
table with fewer rows than the subject has states always has a hole; counting the rows
against the states finds it when reading the rows does not.

This is the defect the card exists to fix, reproduced inside the file asserting the fix.

**[WARNING] The `rm -rf` guard could never fire.** It tested whether the *derived* path
equalled `/`, `/tmp` or `$HOME`; the leaf is always appended, so it cannot. It guarded the
wrong value AND could not return the dangerous answer, while reading as protection in
review. `TMPDIR=$HOME` would have made it `rm -rf ~/kosmos-cut-home` and passed.

**[WARNING] My claim about `browser-checks.sh` was false, and worse than my own
correction had found.** I had already caught that its four-var sandbox is per *board*, not
"per check". The reviewer found the half I missed: most board boot sites do not set
`AGENT_WORKFORCE_HOME` **at all**, so they resolve the operator's home for accounts.
Measured here: `accounts.list()` 5 ambient, 0 under an empty home, and `engine/create.js`
refuses a Claude create outright with no default account. That would silently change
roughly 25 checks in step 3b, a gate that aborts the cut on any red and that I cannot run.

**[WARNING] The "what moves" claim overclaimed**, in the plan and in the script's own
header: "the gates stop reading the live fleet". Re-derived each resolver myself and
confirmed the reviewer: the store, workers root, accounts and LaunchAgents *writes* move;
the projects root, LaunchAgents *reads* (`machine.js:52`, `boardrestart.js:69` use `$HOME`),
the config-root scan (`status.js:46` has its own `homeDir()`), and the tmux roster do not.

**[WARNING] LaunchAgents gains a writer and readers that disagree**, a state the codebase
has never been in. Confirmed at `create.js:237` vs `machine.js:52`.

**[NIT] `indexOf` ordering anchor** could be satisfied by a future comment line.
**[NIT] A pre-existing comment** in `server.test.js` became false.

**Resolution:** all fixed. Step 3b explicitly excluded with `env -u AGENT_WORKFORCE_HOME`,
**because it is unmeasured, not because it is clean**, pinned by an arm. Guard rewritten
to test `TMPDIR` itself. Overclaim corrected. Ordering anchored to a real statement.

#### Iteration 2

**Returned: no BLOCKER. 3 WARNINGs, 3 NITs.** Independently reproduced the headline
measurement and re-derived all eight rows of the corrected table as correct.

**[WARNING] The corrected overclaim never reached the line a person reads.** Round 1's fix
reached the comment block and the plan and skipped `release.sh`'s own `echo`, the only
sentence an operator sees at cut time, which still said the gates "read no live fleet
state" fifty lines beneath a comment explaining that is false.

⭐ **This is the fleet's own "ask what you EMIT, not just what you review" rule, missed
inside the very change that was correcting the same sentence elsewhere.** Corrected, and
pinned by an arm so the message and the comment must keep agreeing.

**[WARNING] `envFor` cleared ambient state by enumeration.** Round 1 named two variables;
round 2 found the third. `KOSMOS_CUT_CHANNEL=bogus` made `release.sh` refuse at line 37 and
took six of eight arms with it (measured `2/8`). It fails loud and cannot occur in a real
cut, but **a list of two names is not a defence against the third**. Now cleared by
construction: drop every `KOSMOS_*` and `AGENT_WORKFORCE_*`, restore only what the arms
need. The new arm sets hostile values **in this process** as a control, so it proves
`envFor` neutralises them rather than their merely being absent.

**[WARNING] The "what moves" table read as exhaustive.** All eight rows correct, framing
wrong. Two measured additions, neither a data root:
`openaiaccounts.list()` **1 to 0** (my step-3b argument had rested only on the Claude
half), and `runners.resolveBin('claude').present` **true to FALSE**, i.e. under the cut
home the product stops believing the Claude CLI is installed.

**[NIT] My count was wrong.** "Seven of nine boot sites" came off a sloppy parse; three set
the variable and six do not. Direction unchanged, number corrected.
**[NIT] Relative `TMPDIR` accepted**, and `$HOME` compared as a literal, which
`$HOME//` and the macOS firmlink spelling defeat; `tools/lib/board-origin.sh` already uses
`-ef` for that reason. Both adopted.
**[NIT] Branch was behind main**, so the recorded count described a stale base.

**Resolution:** all fixed; rebased onto current main and everything re-measured.

### Final Ledger

**Suite, after the rebase, both conditions:**

| condition | result |
|---|---|
| no override | **5957 tests, 5957 pass, 0 fail, 0 skipped, exit 0** |
| ambient `AGENT_WORKFORCE_HOME` (what a real cut creates) | **5957 tests, 5957 pass, 0 fail, 0 skipped, exit 0** |

The second row is the combination round 1 proved had never been measured.

**New file alone:** 11/11, and 11/11 under `KOSMOS_CUT_CHANNEL=bogus`, an ambient
`AGENT_WORKFORCE_HOME`, `KOSMOS_CUT_LIVE_HOME=1` and `KOSMOS_RUN_MARKER_DIR`.

**Seven mutants, each applied alone, restored, with a green control either side:**

| mutant | arms killed |
|---|---|
| control | 11/11 |
| drop the `export` keyword (bare assignment) | 8/11 |
| do not wipe a pre-existing cut home | 10/11 |
| point the cut home at the real `$HOME` | 6/11 |
| ignore `KOSMOS_CUT_LIVE_HOME` | 10/11 |
| accept a relative `TMPDIR` | 10/11 |
| let the page gate inherit the cut home | 10/11 |
| restore the overclaim in the emitted line | 10/11 |

Five kill exactly one arm, which is what a discriminating battery looks like.
`release.sh` verified byte-identical to HEAD after the battery.

### What I would disclose against my own work

- **I cannot run a cut.** The card's acceptance ("a staging cut under the isolated user is
  green") is **unverified by me**, and the separate-macOS-user half is not built: it needs
  keychain access for the Developer ID identity, notarization credentials and a console
  Aqua session for codesign.
- **Step 3b is excluded because it is unmeasured, not because it is clean.** The class this
  card names is still open there, now with a measurement attached for whoever closes it.
- **The class is narrowed, not closed.** A cut-time gate can still enumerate the live fleet
  by name: the roster comes from tmux and the config roots from the real home, and neither
  consults this variable.
- **This steps around #634's premise** rather than breaking it, on every cut, through a
  variable `sandbox.DIRS` does not watch, so `audit()` returns `partial: false`.
- 📌 **Ten claims of mine about neighbouring code failed to survive re-opening tonight,
  across four cards.** Both rounds here found the same class. The reviewers are not
  catching different bugs; they are catching one habit, which is that I write the sentence
  when I form the belief and measure later or not at all.
