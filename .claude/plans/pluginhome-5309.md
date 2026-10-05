# pluginhome-5309: an agent can tell "the plugin is in the person's folder, not mine" (kosmos#5309, slice 1)

## Problem
A day-one report: a CRM plugin installed and enabled in the person's own app never reached their agents, even after
restarts, and nothing could tell them why. Kosmos installs no plugins. A Claude agent reads `CLAUDE_CONFIG_DIR` (unset only
for the default account), and a Codex agent reads `CODEX_HOME`. Each config folder keeps its own
`plugins/installed_plugins.json` (measured on Agent1s: `~/.claude` and an account folder hold different files).

## Change
`engine/connections.js` `blockBody()`: a new section, "A plugin the person installed in their own app", placed before
the Connections tab section. It covers:
- where the agent's own folder is (Claude: `CLAUDE_CONFIG_DIR` or `~/.claude`; Codex: `CODEX_HOME` or `~/.codex`);
- where installed plugins are listed in that folder;
- that a second-account agent does not get the person's plugins, and an API-key agent does not get claude.ai connectors;
- to check the folder first, say plainly when the plugin is in the person's folder only, not to suggest restarting,
  and to name the other failure (a sign-in still needed) when the plugin is present.

Knowledge only: the block stays constant (no argument, no machine state), as its tests require.

## Tests
`engine/connections.test.js`: one new test pinning the section's facts, its position before the Connections tab
section, and no em dash. Red-capable: with origin/main's connections.js it fails (10 pass, 1 fail); with the change 11/11.
Related files run: connections-refresh-1649, connections, discover.adopt, create: 263/263.

## Rejected
- Copying or linking the person's plugins into agent folders: #4592 keeps the desktop app's plugins and their
  untrusted hooks out of agents on purpose.
- A per-agent statement of which folder the agent uses: that is machine state, which this block must not carry.
  The agent reads its own environment instead.

## Follow-up (not this PR)
The board shows, per agent, plugins present in the person's own folder and missing from the agent's (#5309 part 2).

## Weakest premise
The Codex wording rests on `plugins` under `CODEX_HOME` (seen on Codex 0.149.1 here). I did not measure where the Codex
desktop app records a plugin as enabled.
