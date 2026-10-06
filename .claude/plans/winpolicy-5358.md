# #5358: measure the Windows agent's `kosmos` in each shell on the Windows runner; one-key policy fix

## What the report says, and what the code and earlier measurements say
The source report (install 45461372, 2026-10-05): "the `kosmos` CLI is still not on PATH in an agent's own shell",
beside PowerShell scripts refused after a machine policy reset.
- PATH: engine/win32launch.childEnv puts `<zip>\bin` first on every Kosmos-launched agent's PATH (launch,
  launchStreaming, the codex supervisor, agy; task-started agents reach it through the engine pointer).
- Policy: Claude Code's PowerShell tool passes `-ExecutionPolicy Bypass` itself (measured in #570, plan
  win32-cli-verbs line 200), and childEnv already gives codex, gemini, grok and antigravity the process-scope
  variable (#3380). So no Kosmos-launched runner should meet the Restricted policy.

## Call
- RETRACTED (review iteration 1): my first version extended the variable to claude, on the premise that Claude
  Code's PowerShell meets the policy. The #570 measurement says it does not; #3380's claude exclusion stands.
- Kept: the variable is ONE key whatever case it arrives in (an inherited `psexecutionpolicypreference` plus a new
  `PSExecutionPolicyPreference` is the two-keys trap the PATH comment names).
- Review 9: the same case trap held for every other name childEnv touches (the child-session markers,
  KOSMOS_AGENT_TOKEN, CLAUDE_CONFIG_DIR, CODEX_HOME and the like): an inherited `Claude_Config_Dir` survived
  `delete env.CLAUDE_CONFIG_DIR`, the #2129 account leak in another spelling. All of them now go through two helpers,
  envDelete (every spelling) and envSet (one key), in engine/win32env.js since review 11 so the per-turn envs that
  delete one hop later (win32agy and win32keyed: CLAUDE_CONFIG_DIR, XAI_API_KEY) use them too. PATH keeps its own
  one-key line, unchanged.
- Measured on PR #5384's windows job (10-06 04:30): the Git Bash arm passed; the policy arm failed in its own setup,
  because the CI step's PowerShell 7 module path stopped Windows PowerShell 5.1 loading Set-ExecutionPolicy. The arms
  now drop PSModulePath, which models a board started by Explorer or its logon task. NOT MODELLED: a board started from
  a PowerShell 7 terminal, which would pass that path to its agents. PowerShell 5.1 (a gap stated, not measured: #5385).
- New Windows-runner arms measure each shell: Git Bash, run as Claude Code's tool runs it (`bash -c`), finds `kosmos`
  on the agent's PATH (control: not without it; a red says whether it was the PATH or the shim); PowerShell with the flags Claude Code passes (taken from #570, not measured here) finds kosmos.ps1 and runs it under a Restricted policy; codex's `powershell -Command`
  is refused without the variable (control) and runs with it.
- If all pass on the runner, Kosmos's launch path is right and #5358 is specific to that box (most likely an agent
  Kosmos did not launch, or an old build): parked needs-device for a measurement there.

## Weakest premise
That windows-latest (Server, admin) answers the same as a person's Windows 11 laptop for these shells.

## Tests
- engine/win32-kosmos-shell-5358.test.js (pure arms anywhere; shell arms on the Windows runner, the policy arm only
  on GitHub Actions and restoring the CurrentUser policy).
