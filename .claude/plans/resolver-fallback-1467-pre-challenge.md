---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: resolver-fallback-1467
diff_hash: bc59042ded4fa6fe2095cd8e56d4e26f5a43cf3912b019e6c365eb7452229959
subdir_audit: passed
timestamp: 2026-08-29T15:00:07Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent.** Josh ruled 09:24 that he will not review PRs and ready work
should be pushed; kosmos main is unprotected. That removed a PERSON, not a test, so every
gate below is mine and was run.

**Bracketed markers used deliberately**, because the template's own `### BLOCKERs`
heading is refused by this gate. That is my #1458, whose PR is blocked on a book-io org
ruleset. **This proof works around a defect I filed.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING]** `install/kosmos-report-hook.sh` is on the path by which **every agent
  reports its state**. A defect here is silent by construction: reports return success
  and do nothing. Mitigation is that the two new rungs are ordered **last**, so every
  layout that resolved before resolves identically, proven by the installed and source
  arms plus a perturbation that moves a fallback first and turns **both** of them red.
- **[WARNING]** `command -v kosmos` resolves through PATH, which for a hook process may
  be minimal. It is the **last** rung and its failure mode is the pre-existing EMPTY, so
  it can only add resolutions, never remove one.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep on the diff: 0, planted control returns 1.
- **[CONVENTION]** No hardcoded developer path. The live Aug-26 copy resolves via
  `$HOME/work/agent-workforce/install/kosmos`, which works on this machine and would
  ship somebody's personal layout to everyone. Rejected on purpose.

### NITs

- **[NIT]** Three rungs could be a loop over candidates. Kept explicit because each
  carries a distinct reason and the comments are the point.

### Attacked and CLEARED

- **Perturbed three ways, each failing its OWN arm:** remove the `~/.local/bin` rung,
  remove the PATH rung, or move a fallback above the `$HERE` rungs. The third turns the
  installed **and** source arms red, so the **ordering** is guarded, not just the rungs.
  Restores sha-verified.
- **Every arm pins HOME and PATH.** Without that these assertions read the developer's
  machine.
- **Full suite 2918 pass, 0 fail, exit 0**, my arms confirmed present by name in that run,
  against 360 PASS lines as a control that the grep works.

### A defect my own test caught, which is the part worth reading

The rung-2 control **failed**, correctly, and the code was fine. It asserted *"rung 2
refused"* by checking for **EMPTY**, and once fallbacks existed, EMPTY stopped being that
signature. Rung 2 still refused; something later resolved.

⇒ **It was pinning an INCIDENTAL property (nothing else could resolve) to test a SPECIFIC
one (this guard refuses).** Exactly the stale-assertion class, in a test I wrote **this
morning**, found by the test itself rather than by me.

### Strengths

- **[STRENGTH]** The fix was chosen after reproducing the failure deterministically with a
  control, not from the incident report.
- **[STRENGTH]** The inverted arm explains itself in the file, because its previous failure
  message demanded exactly that of whoever changed it.

### What I am NOT claiming

**This deploys nothing.** The live hook at `~/.claude/hooks/user/` is dated Aug 26,
carries **1 of 6** `--auto`, and is wired through `~/.claude/settings.json`, which serves
all 18 agents. Card #1467 stays **open** for that step, which wants an operator watching.
**I have not verified this hook works when actually deployed, only that the function
resolves.**
