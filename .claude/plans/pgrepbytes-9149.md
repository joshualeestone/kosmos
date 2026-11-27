# pgrepbytes-9149: pgrep under LC_ALL=C (kosmos#9149)

## Why
Mortals 11-26 20:28 (Mona Lisa's feedcut-9172 run): tools/test-tunnel-handshake-gate.sh red, three times
`pgrep: Regular expression evaluation error (illegal byte sequence)`, so #9153's fail-closed scan answered CANNOT TELL.
Baron Draxum reproduced it on this Mac: under a UTF-8 locale pgrep exits 3 whenever ANY process on the box has a command
line that is not valid UTF-8, whatever the pattern; under LC_ALL=C the same pgrep exits 1. It reds validations on
Mortals and can hold a promote, which runs the same gate. The 0.8.27 cut is pinned to wait for this fix.

## Plan
- [x] `_gate_pgrep` (tools/tunnel-handshake-gate.sh) runs `LC_ALL=C pgrep -f`; a real failure still fails closed.
- [x] `_kosmos_pgrep_cmdlines` (tools/lib/cut-guard.sh) runs pgrep under LC_ALL=C on both platforms.
- [x] The gate test's leftover-connector count and its pkill run under C (a failed pgrep read as "none left").
- [x] Review 1: also `_kosmos_shell_shards_live` (cut quiet-box wait), heavy-gate's two awks over the process listing
      (macOS awk stopped at the bad record: later processes read as not running), the anchor test's own pgreps, and the
      gate test's EXIT-trap pkill. All under LC_ALL=C.
- [x] Arms use a pgrep that fails with pgrep's words unless LC_ALL=C (no live bad-byte process: one on this shared Mac
      reds other agents' runs of older code, and a reviewer's probe did, to April). heavy-gate: source pin plus awk check.
      Mutations removing C red the gate's two arms, the anchor's shard arm and the heavy-gate pin.
- [x] Review 2: no BLOCKER; its SHOULD-FIXes were the live arms, now stubs as it recommended.
- [ ] Proof, PR, merge on green.

## Decisions
- LC_ALL=C on the call, not on the whole script: the rest of each script keeps the caller's locale.
- Other pgrep callers (ci-runner-setup.sh, ci-runner-claim-pause.sh) are a follow-up slice on #9149: they are not on the
  validation or promote path, and the cut is waiting on this one.
- Weakest premise: that nothing reading pgrep's output needs the caller's locale. The downstream grep in
  kosmos_running_lines already runs under LC_ALL=C.
- Not changed (review 2 NIT): `_kosmos_drop_test_fixtures`'s `[[ =~ ]]` in the caller's locale misses a fixture whose
  own line holds a bad byte; that fails toward busy, the safe side.
- Rounds stopped at 2: round 3 would review a test-only change and the 0.8.27 cut waits on this.
