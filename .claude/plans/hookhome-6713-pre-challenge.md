---
pre_challenge: true
method: challenge-loop
branch: hookhome-6713
diff_hash: d9d80a88a1d39fa4e1b357162ea8f2ea92e8d07d7d76fd4130180f080d2cd6a1
validation: passed (after the rebase onto origin/main: installroot-6713, allowance, accounts, reporthook, accounts.wiredefaulthooks-5612, install.uninstall-unwire-5998, server.allowance-3946 = 142/142; create 234/234, accounts.forget-1659 14/14, a11ystatus 34/34; sh -n install/setup.sh; mutants measured red for the inode-0 fallback, the fail-closed installer, the mixed and refused exits, and the statusline guard)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-20T23:26:12Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16 (opus and sonnet alternating)
**Converged:** Yes. Iterations 15 and 16 found no BLOCKER; iteration 16 found no new WARNING (its one WARNING is a decided case, recorded in the plan).
**Total findings:** 1 BLOCKER, about 18 WARNINGs, 2 CONVENTIONs, many NITs
**Fixed:** the BLOCKER and every WARNING and CONVENTION except the decided cases below | **Asked (awaiting user):** 0

### Per-Iteration Breakdown (this session's iterations 9-16; 1-8 before)

#### Iterations 1-8
- The rule, its gates in accounts.prepare and allowance.ensureStatusLine, setup.sh asking the same rule, identity (device and inode) comparisons, link and /System/Volumes/Data spellings, the default-root install signal, end-to-end setup.sh tests.
#### Iteration 9
- [WARNING] fixed: a leaveAlone that throws in setup.sh's loop now leaves the target alone; tests for the mixed run and the status-line claim.
#### Iteration 10 (sonnet)
- [WARNING] fixed: inode 0 proves nothing; falls back to comparing where links lead.
- [WARNING] DECIDED: a custom KOSMOS_HOME install is a test install (write_install_config's stance; in the plan).
- [NIT] fixed: a mixed run got its own exit and line.
#### Iteration 11 (opus)
- [WARNING] fixed: exit-4 and exit-1 lines were false in some cases; exit 5 added; exit 3 line softened.
#### Iteration 12 (sonnet)
- [WARNING] fixed: the mixed line still named where the wired settings were; now true wherever they are.
- [WARNING] fixed: the status-line sentence could claim a line after a skip; now only for 0 or 1.
- [NIT] fixed: codes moved to 20-22 so node's own exit codes cannot read as them.
#### Iteration 13 (opus)
- [BLOCKER] fixed: engine/allowance.test.js runs the status-line block without the hooks code; an unset code now reads as 0.
- [NIT] fixed: 21 and 22 say the install may not have been checkable.
#### Iteration 14 (sonnet)
- [CONVENTION] fixed: an injected leaveAlone that is not a string or null leaves the file alone.
- [WARNING] DECIDED: Windows wireDefaultHooks keeps #6601's bundleRoot gate; installed detection keys on os.homedir() and fails closed under another HOME.
#### Iteration 15 (opus)
- [WARNING] fixed: setup.sh failed open when the rule would not load; it fails closed, as the board does.
- [NIT] fixed: the installer lines are tested to promise no later setup; a sandbox writes its statusline through the real gate.
#### Iteration 16 (sonnet)
- [WARNING] DECIDED: AGENT_WORKFORCE_HOME equal to HOME is the real home, not a sandbox (in the plan).
- [NIT] left: the measured-on-this-computer test skips its installed arm on a machine with no install (the synthetic layout test covers it).
