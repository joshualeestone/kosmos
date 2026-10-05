# pluginhome-5309: an agent can tell "the plugin is in the person's folder, not mine" (kosmos#5309, slice 1)

## Problem
A day-one report: a CRM plugin installed and enabled in the person's own app never reached their agents, even after
restarts, and nothing could tell them why. Kosmos installs no plugins. A Claude agent reads `CLAUDE_CONFIG_DIR` (unset only
for the default account), and a Codex agent reads `CODEX_HOME`. Each config folder keeps its own
`plugins/installed_plugins.json` (measured on Agent1s: `~/.claude` and an account folder hold different files).

## Change
`engine/connections.js` `blockBody()`: a new section, "A plugin the person installed in their own app", placed before
the Connections tab section. It lists where a plugin the agent cannot use may be, each checkable by the agent itself:
its folder (compare actual folders, not the account), its account (claude.ai connectors), and the app it was added in
(the desktop app's chat side). Then: say which one plainly, no restart for those, the in-folder causes to look at, and
"say you do not know yet" when none fits.

- A default agent's folder is not always `~/.claude`: bin/agent-supervisor.sh passes a tmux-global CLAUDE_CONFIG_DIR into
  the pane when one is set (EFFECTIVE_CCD), so the text tells the agent to compare folders, not infer from the account.

Knowledge only: the block stays constant (no argument, no machine state), as its tests require. It deliberately names no
file inside a provider folder: where Codex records an enabled plugin, and how account-synced Claude plugins arrive, were
not measured.

## Tests
`engine/connections.test.js`: one new test pinning the section's facts, its position before the Connections tab
section, and no em dash. Red-capable: with origin/main's connections.js substituted in (`git show origin/main:engine/connections.js`), `node --test
engine/connections.test.js` gives 10 pass, 1 fail; with the change 11/11.
Related files (`node --test server.connections-refresh-1649.test.js engine/connections.test.js engine/discover.adopt.test.js
engine/create.test.js`, from the worktree): 263/263 at the first commit and again at f13b85c84. Full validation: Mortals, at the final head.

## What each claim rests on (connections.js's own rule: only what was read off the product)
- Measured on Agent1s: each Claude config folder has its own `plugins/installed_plugins.json` (two folders, different
  files); each record carries a `scope` field (`user` here), so a narrower scope exists; the desktop app keeps
  `claude_desktop_config.json` under `~/Library/Application Support/Claude/`, apart from any Claude Code folder; Codex
  0.149.1 keeps `plugins/` inside its home. Read from code: CLAUDE_CONFIG_DIR / CODEX_HOME / EFFECTIVE_CCD.
- "Kosmos does not install provider plugins": `git grep` on origin/main over engine, bin, server.js and install (tests
  excluded) for enabledPlugins, installed_plugins, `plugin install`, `plugin add` and 'plugin': 0 hits (control:
  CLAUDE_CONFIG_DIR, 131 hits in the same scope).
- `.claude.json`: measured at `~/.claude.json` beside `~/.claude`, and at `<CLAUDE_CONFIG_DIR>/.claude.json` inside an
  account folder. That MCP servers are recorded there was reported by a reviewer, not measured here (no server is configured on this box); likewise that a
  `--scope project` server is kept in the project's `.mcp.json` and
  matches the file's role; no server is configured on this box to show the exact keys.
- `claude mcp add` defaults to `--scope local` (measured: its `--help`, default "local"); that local scope ties the
  server to the project folder it was added from was reported by a reviewer, not measured here.
- Codex's folder: `CODEX_HOME`, default `~/.codex` (bin/agent-supervisor.sh defaults it to `$HOME/.codex`; `codex mcp
  --help` names `~/.codex/config.toml`).
- The commands named first: `claude plugin list` ("List installed plugins"), `claude mcp list`, `claude auth
  status` ("Show authentication status") and `codex mcp list`, each read from its own `--help` on this box. Not called read-only:
  `claude mcp list`'s help says approved servers are health-checked. Not
  `codex plugin list`: its help says it lists plugins AVAILABLE from marketplaces, not installed ones.
- That a connector added from the desktop app's Connectors screen belongs to the account is not measured; worded as
  "may", with the account check as the action.
- "Some plugins can come with the account": both Claude folders here hold `plugins/synced/<id>` folders keyed by an
  account-style id; how they arrive was not measured, so it is worded as a reason to compare accounts, not a rule.
- `claude mcp list` "starts or contacts each one": its `--help` says approved servers are health-checked.
- Scope reach: only the measured default is stated (`--scope local`, from `claude mcp add --help`); for the rest the
  agent runs `claude mcp get <name>` (exists, per its `--help`). The earlier per-scope reach lines were reviewer-reported
  and kept drawing corrections, so they were deleted rather than reworded.
- `enabledPlugins` in `settings.json`: read on this box (`~/.claude/settings.json` has it).
- The account bullet is limited to Claude: the Codex counterpart (ChatGPT-side connectors) was not measured.
- Not measured, so worded as checks for the agent, not as facts: that a claude.ai connector reaches only the same account
  and not an API key; that a reload picks up a late-added plugin.

## Rejected
- Copying or linking the person's plugins into agent folders: a second account's folder is separate by design (its
  own sign-in), and #4592 (PR #4605, open) proposes the same separation for Codex because desktop-app plugins brought
  hooks agents were never told to trust. Carrying plugins over is a decision for that card, not this text.
- A per-agent statement of which folder the agent uses: that is machine state, which this block must not carry.
  The agent reads its own environment instead.

## Follow-up (not this PR)
The board shows, per agent, plugins present in the person's own folder and missing from the agent's (#5309 part 2).

## Weakest premise
That folder and account are the two causes worth naming. The text stays general where I measured nothing (Codex's
enabled-plugin record, account-synced Claude plugins under `plugins/synced/`), so an agent checks rather than trusts it.
