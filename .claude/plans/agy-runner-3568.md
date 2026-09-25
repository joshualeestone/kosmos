# Plan: #3568 PR 1, an Antigravity (agy) launcher behind a flag

## Finished looks like
With AGENT_WORKFORCE_ANTIGRAVITY=1, creating an agent with provider 'antigravity' makes a launchd
job whose supervisor starts Google's `agy` in the agent's tmux pane with its documented
auto-approve flag, the agent's brief in AGENTS.md, no Claude trust or account written, and the
board able to type into the pane. With the flag off (the default), no route can set up an
Antigravity agent: 'antigravity' is refused as an unknown provider exactly as before, and no
user-visible surface offers it. Recognising a pane that runs `agy` does NOT depend on the flag, on
purpose: an agent set up while it was on must stay visible, messageable and adopted (not killed)
after it is turned off. The one new effect with the flag off is therefore narrow: a Kosmos session
whose pane runs `agy` reads as a live agent in state unknown rather than a stopped shell. (One
more, and deliberate: an imported entry recorded as antigravity used to fall back to Claude and is
now refused while the flag is off, rather than putting Claude in an agy folder. Tested in
engine/worldstarts.test.js.)

## Why
Splinter 2026-09-25 04:47: take #3568's next step that does not need Josh's sign-in, the runner
behind a flag, against agy's documented CLI. The research (on the card) recommends agy as the
only "sign in with your Google subscription" path that works for ordinary people today.

## Decided
- Provider id 'antigravity' (runner 'antigravity'): 'google' already means the Gemini CLI.
- Flag gates every ACCEPT point: createAgentInner, setProvider, installJob (which connect, repair
  and backfill all reach), and connect's provider hint. The maps below are inert without them.
- Launch: `agy --dangerously-skip-permissions [--model <m>]` (agy 1.2.10 --help). No default
  model: agy picks its own until somebody signed in can list them.
- Binary: env AGENT_WORKFORCE_ANTIGRAVITY_BIN, else ~/.local/bin/agy (agy's own installer path,
  under the AGENT_WORKFORCE_HOME seam, like Claude Code's).
- Refused for now: an account (the person signs in inside the pane; Kosmos never reads or reuses
  agy's stored sign-in, per Antigravity's terms), Windows (no launch path), installJob on win32.
- Board: an `agy` pane command counts as an agent session only in a Kosmos session (the literal
  name, like `codex`), and outranks a crashed shell in its session. classify has an antigravity
  arm ahead of the Claude one: agy running -> unknown ("Kosmos cannot read what Antigravity is
  doing yet"), not running -> stopped naming Antigravity. It returns before any screen scrape, so
  no Claude marker can be read off an agy screen. The context ring says it cannot read an
  Antigravity agent's memory yet instead of falling to the Claude transcript reader. The
  Anthropic observation arm also excludes antigravity panes; with the classify arm returning
  first that exclusion is defence in depth and cannot be made to fail through today's producer.
  Chat uses the codex/gemini/grok Enter gap and names Antigravity.
- Folder trust (found by the signed-in spike, 2026-09-25): agy asks "trust this folder?" on every
  new folder even with --dangerously-skip-permissions, has no flag to skip it, and records trust per
  exact folder in ~/.gemini/antigravity-cli/settings.json `trustedWorkspaces`. engine/agytrust.js adds
  the agent's (resolved) folder there, keeping every other setting and leaving an unreadable file
  alone; the supervisor's antigravity arm runs it before every launch. Measured live: a folder
  pre-trusted this way launches straight to agy's prompt and answers a typed message.
- Supervisor: the Claude-only pane settings (CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN and the
  server-global CLAUDE_CONFIG_DIR pin) are not given to an agy pane.
- installJob refuses an account dir for an antigravity agent (accountEnvVar would otherwise write
  it as CLAUDE_CONFIG_DIR), covering backfill, repair and an import's first start.
- The Antigravity program must be named `agy`: the board (status.isAntigravityCommand) and the
  supervisor's adopt check recognise the pane by that command. Enforced, not just documented:
  create, switch and backfill refuse any other name with a sentence saying why, and resolveBin
  reports such an override as not present. The name checked is the real file after symlinks
  (runners.agyRealName), because that is what the pane shows.
- Supervisor adopt path: `agy` is in the live-agent allowlist beside codex, so a re-run of the
  supervisor adopts a live Antigravity session instead of killing it as a crashed shell.
- The supervisor's per-variable forwarding loop skips CLAUDE_CONFIG_DIR for an agy pane, so an
  account folder in the supervisor's own env is not handed to it explicitly. A tmux server-global
  CLAUDE_CONFIG_DIR still reaches the pane by ordinary tmux inheritance; agy does not read it.

## Changed
engine/runners.js (resolveBin), engine/create.js (maps, flag, binPaths, create/setProvider/
setModel/installJob/setAccount/trust arms), bin/agent-supervisor.sh (launch arm), engine/status.js
(runner normalisation, isAntigravityCommand, observation exclusion; the classify arm and the
snapshot exclusion key on the runner tag OR the agy command, as codex does), docs/browser-checks/render-talk.js
and render-talk-goldencard-2519.test.js (the NONE_BASE family count 15 -> 16), engine/chat.js (names, Enter
gap), engine/register.js (repair keeps the runner), engine/agytrust.js (folder trust, with its test), engine/discover.js (connect's provider hint
honours the flag), server.js (whoami names Antigravity). Tests: create (flag off/on, no Claude trust
entry, refusals, maps, supervisor text, launch-line count 6 -> 7), setProvider flag gate,
installJob win32 and account refusals, repair keeps the runner, runners (resolveBin), status
(agy pane session and classify), chat (a dead agy agent names Antigravity), discover.adopt
(flag-off hint, flag-on control), worldstarts (a flag-off import), supervisor.pane-reach (the pane env, forwarding loop and adopt check, run under bash).

## What the flag does and does not do
It stops Kosmos setting up a NEW Antigravity agent by any route. It does not stop one that was set
up while it was on: that agent's launch job still starts agy at login, and backfill or repair
refuse it with a sentence that says setting up is switched off, not that the agent is off.

## Not in this PR
Status from agy's documented hooks (PR 2), a transcript/context reader, accounts, UI, a managed
install. Also left, and the same for Gemini and Grok today: `kosmos whoami`'s live process walk
(engine/runningas.js) knows only claude and codex, so for an agy agent it says nothing like Claude
or Codex is running and falls back to the recorded runner; and the "cannot reach a Claude
subscription" banner (server.js someAgentNeedsClaude) excludes only codex, so an agy-only machine
could still show it; and the Claude login-expiry advisories (engine/status.js
computeLoginAdvisories) read every named pane's CLAUDE_CONFIG_DIR, which an agy pane can inherit
from the tmux server, so an agy agent could be listed in a Claude sign-in warning. All three belong
with the UI slice, for every non-Claude runner at once.

**Before the flag is turned on anywhere but a test machine:** the board page does not know the
'antigravity' runner yet (its provider and label helpers fall to their default), so an agy card
would be mislabeled. The UI slice has to land first.

## Measured with Josh's sign-in (2026-09-25 07:37-07:45)
Google subscription login ("Antigravity Starter Quota"), no API key. The pane reads `agy` (also after
agy self-updated 1.2.10 -> 1.2.11; still a regular file). Typed messages are submitted and answered.
It reads its brief (AGENTS.md). --dangerously-skip-permissions auto-approves a file write. The
first-run trust prompt was the one blocker, now pre-answered.

## Weakest premise
That agy keeps `trustedWorkspaces` in settings.json as a list of exact folders across updates. It is
read and merged, never rewritten wholesale, and a file that does not match is left alone, so a change
fails back to the visible trust prompt rather than breaking agy. The other earlier premises (a
signed-in launch, the pane reading exactly `agy`, a regular-file install) were measured on
2026-09-25; see the section above. A later installer that moves agy to a versioned symlink is
caught by the name check (runners.agyRealName) for NEW setups only: an agent already running
would then show a version string in its pane and read as stopped until the recognition learns the
new shape. The supervisor would still adopt it (its version-string rule), so it is not killed.

Not handled, recorded: removing an agent leaves its folder in agy's trusted list (add-only). A
follow-up belongs beside the removal path.
