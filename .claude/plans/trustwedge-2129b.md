# #2129 trust wedge on UPDATE: default-account writes target the config the AGENT reads

## The bug (root-caused by reproduction, not theory)

A newly-created agent freezes on Claude Code's workspace-trust prompt (unanswerable
in a non-interactive TUI). The prior fix (#2144, `createIfAbsent`) resolved FRESH
installs but not the UPDATE case Josh hit (0.6.28 -> 0.6.29 update, existing
`~/.claude.json`). Confirmed: #2144 IS in the served 0.6.29 build, so this is a real
insufficiency.

**Not a file-absent-vs-present split -- a clean-env-vs-used-env split.** A DEFAULT-
account agent launches with NO `CLAUDE_CONFIG_DIR` (and no `CODEX_HOME`), so Claude
Code reads `~/.claude.json` (and codex reads `~/.codex`). But the Kosmos board
inherits the app's launch environment (native-app/main.swift copies its own env to
the board), which on a USED machine can carry `CLAUDE_CONFIG_DIR`/`CODEX_HOME`. The
write resolvers `CONFIG(null)` (trust), `SETTINGS(null)` (the #1919 bypass) and
`codexHomeDir()`/`defaultHome()` (codex trust) all HONOUR the engine's own env vars.
So the default-account writes landed in the ENGINE's account config while the agent
read the home default: trust written, agent still stops on the prompt. That is why
the fresh Mac Mini (clean env) worked and an updated used machine did not, and why it
was "same for OpenAI/Codex". Reproduced with harnesses (`repro_config.js` etc.).

## The fix

For an agent that will run on the DEFAULT account (no `configDir`), the trust,
bypass and codex writes target what a no-env agent reads, IGNORING the engine's own
`CLAUDE_CONFIG_DIR`/`CODEX_HOME`:

- `engine/trust.js`: `defaultAgentConfig()` (`AGENT_WORKFORCE_CLAUDE_CONFIG` ||
  `AGENT_WORKFORCE_HOME`||home `/.claude.json`) and `defaultAgentSettings()`
  (`AGENT_WORKFORCE_CLAUDE_SETTINGS` || `AGENT_WORKFORCE_HOME`||home
  `/.claude/settings.json`). `trustFolder` and `preacceptBypass` use them when the
  caller passes `agentDefaultAccount` (only for `!configDir`).
- `engine/create.js`: `defaultAgentCodexHome()` (`AGENT_WORKFORCE_CODEX_HOME` ||
  `AGENT_WORKFORCE_HOME`||home `/.codex`, skipping the engine `CODEX_HOME`).
  `trustCodexFolder`/`forgetCodexFolder`/`dismissCodexUpdateNotice` use it under the
  same flag.
- The flag is threaded from every caller: create (Claude trust + bypass + codex),
  setAccount, adopt, and remove (untrust), each passing `agentDefaultAccount = !<its
  configDir>` so the value is true exactly when the agent launches with no config dir.

## Why the AGENT_WORKFORCE_* seams

The write must go to the agent's real home in production, but a TEST must never touch
the operator's real `~/.claude`. The resolvers honour the existing sandbox seams:
`AGENT_WORKFORCE_CLAUDE_CONFIG`, `AGENT_WORKFORCE_CODEX_HOME`, `AGENT_WORKFORCE_HOME`
(the home fallback, which the create suite already sets), plus a new
`AGENT_WORKFORCE_CLAUDE_SETTINGS` for the bypass file. Without the `AGENT_WORKFORCE_HOME`
fallback, a default-account test would write to the real `~/.claude/settings.json` --
a footgun caught while building this and closed.

## Decisions / rejected

- **Rejected: hardcode `homeDir()` for the default account.** It writes to the real
  `~/.claude` in tests, and the create suite's `CLAUDE_CONFIG_DIR` sandbox no longer
  redirects it. The seam-honouring resolvers are the safe form.
- **Included the bypass and codex arms**, not just the Claude trust: the bypass and
  codex prompts also block a fresh agent, so a trust-only fix would clear one prompt
  and reveal the next (whack-a-mole). Josh tested "same for OpenAI/Codex".
- **Weakest premise:** that Josh's board actually carries `CLAUDE_CONFIG_DIR`/`CODEX_HOME`.
  I could not read his env (never ask the operator to look it up). The fix is a genuine
  correctness improvement regardless; a re-test (Splinter coordinates) confirms
  efficacy on his box. On THIS machine the dev board runs clean, so the write already
  lands right here -- which is exactly why the divergence needs a used-machine env to
  bite.

## Verification

- `engine/trust.wedge-update-2129b.test.js` (6): resolvers skip the engine env, honour
  the seams; `trustFolder`/`preacceptBypass` land in the default-agent config/settings,
  not the engine dir.
- `engine/create.codex-wedge-2129b.test.js` (4): `defaultAgentCodexHome` skips
  `CODEX_HOME`; `trustCodexFolder`/`forgetCodexFolder` round-trip in the default home.
- `engine/create.test.js`: the #1919 test rewritten to prove the bypass ignores the
  engine `CLAUDE_CONFIG_DIR` end-to-end; a source wiring guard pins that create/
  setAccount opt in; the #1315 codex-dismiss anchors re-aimed at the new signature.
- Full trust/create/remove set: 287 pass. Full `node --test` suite + test:shell via the
  challenge-loop validation.
