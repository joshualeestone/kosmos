---
pre_challenge: true
method: challenge-loop
branch: credwrite-1787
diff_hash: 8d8d02b0b293b9d1870cebef14452ce47f70d88d52ff40239006e75233639aee
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T02:38:58Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13
**Converged:** Yes (iteration 13 blind pass returned no undisclosed exploitable defect)
**Total findings across the loop:** many; every pass after the first found a defect a
previous pass had introduced, which is the whole argument for not calling a quiet pass
convergence. Two of the author's own were serious (a symlink hole in the restore path
whose first fix was itself an unprotected symlink write; an offset bug in that fix that
corrupted the file), each caught by the next pass and fixed.

## The feature (a SECURITY fix)

kosmos#1787: `sendertoken`, `cloudflare`, `githubdevice` and `tokendoor` wrote a plaintext
credential with `writeFileSync(FILE, secret, { mode: 0o600 })` and chmod'd afterwards. The
`mode:` option applies on CREATE ONLY, so on a pre-existing file the secret bytes land at
the old (possibly 0644) permissions -- the exact belief #1761 disproved. Extracted one
atomic writer, `engine/securewrite.js`, and routed all four call sites through it:
create-exclusive `openSync(tmp,'wx',mode)` with `fchmod` before the write, symlink refusal
(`O_NOFOLLOW` plus a hand check for win32 where it is undefined), atomic rename to a fresh
inode, restore-through-descriptor on the fallback, `err.code` (never `err.message`, which
carries the credential path) in every operator-facing error.

## Verification

Full suite green on the rebased tree (`node --test engine/*.test.js *.test.js` + `test:shell`):
EXIT_CODE=0, 3639 passes, 0 failures, 33 credential-module subtests confirmed run. Rebased
onto origin/main (cbbda1a3), 0 behind, clean merge, empty overlap with main's changes.

Every guard was mutation-verified to redden BY NAME when the production line it protects is
reverted (the loop's recurring failure was arms that stayed green with the fix reverted; each
was fixed to bite). The iteration-13 blind reviewer independently confirmed, neutering:
- `securewrite.js:267` fallback symlink-refusal call -> 2 arms red
- `securewrite.js:298/299` fallback `fchmod` moved after the write -> "tightens BEFORE" red
- `securewrite.js:212` dropped `mode` from the atomic `openSync('wx')` -> "chmod failure costs ZERO retries" red (create-mode is load-bearing when fchmod fails)
- `securewrite.js:348-353` restore via path instead of descriptor -> TOCTOU arm red

Security properties confirmed by direct construction: a symlink AT the atomic target is replaced
by rename (victim untouched, secret lands fresh-inode at 0600); no wide-mode window; no secret
in any thrown error; an existing token is not destroyed on a failed write.

## Two disclosed residuals (neither blocks the merge)

1. **Orphan temp surviving revocation (LOW).** A process death in the `openSync(wx)` ->
   `renameSync` window leaves `<file>.kosmos-*.tmp` at 0600 holding the secret, which
   `forget()` does not remove. Deliberately NOT fixed here (folding an `unlink` reaper into a
   security fix ships an unreviewed delete path); carded as **kosmos#1793** with a provably-safe
   self-identifying-temp reaper design. Microsecond window, no observed instance.
2. **#1799 concurrency fold-in (INFO).** Device-flow generation threading landed on this branch
   (iterations 9-11), a real flow-identity race the author's arm surfaced. Traced correct by the
   blind pass (no `await` between the `gen !== GEN` check and the synchronous `writeSecret`).
   Landing it with #1787 was decided and concurred on kosmos#1799; disclosed for revert scope.

## Per-Iteration Breakdown

#### Iteration 13 (converged)
No undisclosed exploitable defect. The blind reviewer neutered four guards and each went
red by name (see Verification above); confirmed the security properties by direct
construction; confirmed the macOS-blind symlink arms are each guarded. Two residuals raised,
both already handled and disclosed: the orphan-temp (kosmos#1793, deferred by design) and the
#1799 concurrency fold-in (traced correct, land-together concurred). No new in-scope finding.

Iterations 1-12 each addressed the prior pass's findings; the loop's recurring failure was
arms that stayed green with the fix reverted, and each was rebuilt to redden by name.

### Final Ledger

| # | Iter | Category | Where | Description | Status |
|---|------|----------|-------|-------------|--------|
| 1 | 13 | STRENGTH | securewrite.js | every guard reddens by name on mutation; no decoration | VERIFIED |
| 2 | 13 | CONVENTION | forget() reaper | orphan temp survives revocation | DEFERRED (kosmos#1793, by design) |
| 3 | 13 | NIT | githubdevice.js | #1799 concurrency folded into a security PR | DISCLOSED (traced correct, concurred) |

### Strengths
- One atomic writer replaces four ad-hoc plaintext-then-chmod sites; the wide-mode window is closed by construction.
- Errors report err.code, never err.message, so the credential path cannot reach an operator-facing error.
- Trap-aware arms: each guard proven red-without / green-with by mutation.

## No em dashes in the added engine comments or tests (ASCII throughout).
