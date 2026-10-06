# #5358: a Windows agent's `kosmos` runs in PowerShell under a Restricted script policy

## What the report says, and what the code says
The source report (install 45461372, 2026-10-05): "the `kosmos` CLI is still not on PATH in an agent's own shell"
and, in the same paragraph, PowerShell scripts refused ("running scripts is disabled") after a machine policy reset.
- PATH: engine/win32launch.childEnv puts `<zip>\bin` first on every Kosmos-launched agent's PATH (launch,
  launchStreaming, the codex supervisor, agy), and the task-started supervisor reaches the same code through the engine
  pointer. Read, not measured on Windows.
- PowerShell: a bare `kosmos` resolves to `bin\kosmos.ps1`, which a Restricted policy (the Windows CLIENT default)
  refuses. An agent reads that as "kosmos is not there".

## Call
- childEnv sets `PSExecutionPolicyPreference=Bypass` (PowerShell's PROCESS scope) for an agent that was given the
  CLI folder, and never over a value the environment already sets (any spelling of the name).
- Process scope outranks CurrentUser and LocalMachine. It does NOT outrank a Group Policy (MachinePolicy/UserPolicy);
  a managed machine that forbids scripts still refuses kosmos.ps1. Stated on the card.
- Rejected: a `kosmos.cmd` shim for cmd/PowerShell. kosmos.ps1's own header records cmd's `%*` mangling messages
  (multi-line replies cut, `&` run as a command), and in PowerShell the .ps1 is still found first.
- Rejected: `-ExecutionPolicy Bypass` per call. Claude Code starts the agent's PowerShell, not Kosmos.

## Weakest premise
That the reporting agent's shell was PowerShell under that policy. If it was Git Bash, the PATH half is the defect;
the Windows test's Git Bash arm measures that a login shell finds `kosmos` on the agent's PATH.

## Tests
- engine/win32-kosmos-shell-5358.test.js: pure arms (any OS) for the env; Windows arms on the Windows CI runner:
  Git Bash login shell finds `kosmos`; under a Restricted CurrentUser policy the shim is refused WITHOUT the
  preference (control) and runs WITH it. The policy arm runs only on GitHub Actions and restores the policy.
