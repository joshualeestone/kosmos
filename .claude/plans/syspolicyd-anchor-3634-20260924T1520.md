# syspolicyd keeps crashing on Agent1s: a test execs a binary, then overwrites it (#3634)

## Root cause (measured 2026-09-24)
All 28 retained syspolicyd crash reports (from 09-19) share one stack: EXC_BAD_ACCESS at 0x8 in
`Security::Universal::architecture()` < `MachORep::signingData` < `SecStaticCode` validation.
In the unified log, each crash with retained logs (14:33:02, 14:34:3x, 07:13) has, in the SAME
second, an exec of `$TMPDIR/.../kosmos-anchor-XXXXXX/Kosmos/runtime/node.exe` (AMFI: adhoc signed),
followed by syspolicyd exiting with SIGSEGV. In the 14:33 case, syspolicyd's last log line before
dying is a scan whose quarantine check says the file is gone.

That path comes from `engine/win32anchor.test.js`, arm "A ZIP THAT CHANGES NODE REPLACES THE RUNNING
ANCHORED INTERPRETER". It copies the real node binary to `runtime/node.exe`, spawns it, and right
after the spawn event calls `ensureAnchored`, which overwrites that same path with a text stand-in.
On macOS the exec is still being assessed by syspolicyd, which then reads a Mach-O that has become
text underneath it and null-derefs. While launchd throttles the respawn, every `#!` exec on the box
hangs (the Agent1s stalls, #3582).

## Call
Off Windows the arm never creates the binary: the anchored file is a text stand-in, and the process
runs on the original `process.execPath`. The lock this arm exercises is Windows-only (its control is
win32-gated), so no Mac coverage is lost; the swap path still runs. With no Mach-O in the anchor the
crash is impossible by construction, whatever later edits exec. The arm asserts, before its
spawn, that off Windows the anchored file is not a Mach-O (thin or fat magic): a behavioural guard,
not a source-text pin (an earlier same-line pin false-positived on safe refactors). Scope: this arm
only. The repo's other `copyFileSync(process.execPath` tests are safe because each is skipped off
Windows, not because of this guard. The
"old process keeps running" assertion is now Windows-only (off Windows it could not fail).

## Rejected
- Waiting for the spawned process to report "ready" before overwriting. It narrows the race but still
  execs a copied ad-hoc binary on the Mac for no coverage the Mac can give.
- Reproducing the crash to prove the fix. It takes down exec for every agent on the box. The proof
  is instead that the fixed file never execs the anchor path (log-checked, 0 lines) with the same
  grep that finds it in the crash windows.

## Weakest premise
That this arm is the ONLY trigger. Three of three crashes with retained logs match it; the older
crashes' logs have rotated. What would change my mind: a new syspolicyd crash after this merges with
no `kosmos-anchor` exec in its second.
