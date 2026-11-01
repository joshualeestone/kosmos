# sandboxstart-4655: a sandboxed shell never launches a board with its own hands (kosmos#4655)

## Problem
A board started from a sandboxed shell inherits the sandbox for good. #4636 covers a sandbox that also blocks 127.0.0.1. A sandbox that allows it but blocks the internet read as healthy to every command, while no AI provider could be reached, and the start reported success.

## Change
- `cmd_start`, direct path only, after the supervised branch: refuse when `_shell_is_sandboxed`, before anything launches, and put a deliberate stop back.
- `board-run`, unless launchd is its parent: the same refusal.

The supervised start is not refused: launchd or systemd launches that board.

## Rejected
Testing the internet from the shell: the check would depend on the network, and #4636's ps evidence is already measured.

## Weakest premises
- Reasoned, not measured: a job launchd starts on a sandboxed shell's kickstart runs outside the sandbox. Johnny Cage's plan measured only that launchctl is reachable. Measuring it needs the real gui domain.
- A false positive: ps failing twice 0.2 s apart in an ordinary shell (a process limit, or an MDM-restricted account, which is not measured) now refuses a direct start. A process limit passes on the next try. An MDM account still has the app and launchd.
- A sandbox that lets /bin/ps run gives no evidence, as in #4636.
- `PPID = 1` as "launchd is the parent" assumes the job's ProgramArguments run install/kosmos directly, as setup.sh's plist does today.
- #4636's launch-then-stop branch can no longer be reached by a direct start under the same evidence. It stays as a fallback, and its tests run against a copy without this refusal.

## Verification
cli.sandbox-4636.test.js with a profile allowing loopback: start and board-run launch nothing and a deliberate stop stands. Controls: a normal shell launches, the sandbox without the refusal launches. Removing the board-run line fails its arm.
