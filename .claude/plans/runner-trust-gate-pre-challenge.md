---
pre_challenge: true
method: challenge-loop
branch: runner-trust-gate
diff_hash: 50b7ca8d0cfb85a5a52f6c53e6e43c7e8ef28a56633411c974e5ae3ccf870d8c
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T05:19:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 | **Converged:** Yes (iteration 3 was essentially clean; the one contrived reporting nit it raised is fixed, message-only).
**Total findings across the run:** several BLOCKER-class caught EARLY (before shipping) + WARNINGs. **Fixed:** all actionable | **Deferred:** 1 (a documented, follow-up-carded migration edge).

kosmos#2129 / the 0.6.42 keystone blocker #5: new agents (Claude AND codex) stall on the runner's own first-run directory-trust menu on a fresh macOS user, which kills the agent (Enter = No/exit). Root cause MEASURED: the trust key was written under a different SPELLING of the folder than the one the runner looks up. Fix: key on the ON-DISK canonical spelling via `fs.realpathSync.native` (the OS realpath(3) the runner itself uses), which matches by construction. Full suite green (4988/4988).

### Per-Iteration Breakdown (the loop earned its keep -- it caught two WRONG fixes before either shipped)

#### Iteration 1a -- dual-key (raw + realpath). REVERTED.
Review + a direct measurement showed `fs.realpathSync` does NOT case-fold on macOS, so the dual-key never produced the capital on-disk spelling -- it would have merged green and failed Josh's next fresh-user test (the exact recycling loop). The dual-key ALSO broke the #169 undo contract (6 failing undo tests). Both fatal; reverted.

#### Iteration 1b -- readdir-walk canonicalOnDisk. REVERTED.
A hand-rolled walk to recover the on-disk case worked for ASCII Work/work but only APPROXIMATED the OS's unicode folding (JS toLowerCase/normalize != OS realpath), and readdir'd every ancestor from `/` per create. Review pointed at the repo's own proven primitive.

#### Iteration 2 -- fs.realpathSync.native. Core SOUND.
Measured: `realpathSync.native(lowercase) === process.cwd()-after-chdir === the runner's lookup`. Review tried to falsify the equality (mid-path symlinks, firmlinks, ..) and could not; the primitive matches the runner by construction. One WARNING: keying codex FORGET on canonicalOnDisk made it disk-state-dependent -- a manual folder-delete before removal stranded the entry and falsely reported success. FIXED: forgetCodexFolder tries BOTH spellings (canonical + raw), covering the normal case, migrating an old raw-keyed entry, and reporting honestly.

#### Iteration 3 -- essentially clean.
Confirmed the two-spelling forget loop is correct on every axis (in-place mutation across two passes, seam collapse per removal never touches the person's own tables, no cross-folder removal, dedup right, write path intact). One contrived WARNING: both spellings present AND one hand-edited -> the report said "took it back" without naming the hand-edited residue it (correctly) left. FIXED: message-only, the return now names the hand-edited block.

#### Iteration 4 (this proof) -- converged.
Only the message-only iter-3 fix remained; targeted suites 227/227 and the full suite 4988/4988 hold with it.

### Deferred (documented, follow-up card)
Old lowercase trust entries from prior builds are not auto-migrated on the Claude side (harmless stale entries; fresh users -- the blocker -- unaffected; codex removal now cleans an old raw entry). And the one unrecoverable forget edge (a native-cased entry whose worker folder was manually deleted before removal) is documented in-code -- the stored case is gone, so it is left inert.

### Strengths
The trust key is now the SAME OS-realpath the runner uses, so it matches the runner's lookup by construction (case + unicode + symlink), verified by a test that pins `canonicalOnDisk === process.cwd()` via two independent syscalls with a control proving plain realpath missed. Single-key, so the #169 undo contract is untouched. The three updated codex assertions no longer pin the bug (they assert the resolved spelling). Verify bar remains Josh's real fresh-install re-test; the companion one-click fallback insures the non-spelling residual.
