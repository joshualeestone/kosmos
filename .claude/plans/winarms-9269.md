# winarms-9269 (kosmos#9269, first slice: the codex and grok stand-ins)

**Problem.** Five test files skipped their sign-in arms on Windows because their stand-in codex or grok was a `#!/bin/bash` script, which Windows cannot run by its shebang. What they check does exist on Windows. The drivers spawn the runner directly (no shell), so a `.cmd` would not do either.

**Change.**
- **Production.** openaiaccounts.js (two spawn sites: add-by-key, and the ChatGPT sign-in) and grokaccounts.js (one, the sign-in) start the runner through `tunnelCommand(bin, args)`, #8449's seam. A path ending in `.js` or `.cjs` starts as this node with the script first; any other path starts exactly as before.
  - On Windows a real codex or grok resolves to `codex.exe` or `grok.exe` (runners.js), so a real start never changes.
- **Tests.** Each bash fake is a node script with the same switches, output, exit codes and files written. The grok helper diffed both versions byte for byte, with a broken copy as a control.
  - Arms that skipped only for the stand-in now run.
  - Skips left: signals (a fake that ignores SIGTERM), chmod used to force a failure (still owed here), and symlinks.
  - The ChatGPT driver test also stubs the browser opener, so a Windows run never opens auth.openai.com, and on Windows it expects device mode through chatgptLoginMode.

**Measured on GitHub windows-latest (run 46128165870)**, before (main, run 46120990799) to after, as pass/skip:
- openaiaccounts: 69/13 to 82/0
- openaiaccounts.chatgpt-driver-2338: 2/12 to 13/1
- grokaccounts.reauth-3391: 1/12 to 10/3
- grokaccounts.reauthcancel-6000: 1/13 to 8/6
- grokaccounts.subscription-3391: 15/11 to 25/1

That is 50 more arms run, with 0 failures; tunnelcommand-8378 5/5. On this Mac the five files keep their counts with 0 skipped, and windows-tests-1777 passes 24/24.

**Not in this slice (still owed on #9269):** the claude probe's fake, handoff's stub git, filewho's UNC arm, and the chmod-forced-error arms.

**Weakest premise.** A runner override (AGENT_WORKFORCE_CODEX_BIN or AGENT_WORKFORCE_GROK_BIN) that points at a real `.js` CLI now starts through node. That is what such a path needs anyway, since a shebang does not run on Windows. It is a behaviour change only for that unusual override.
