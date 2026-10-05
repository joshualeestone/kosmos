# pluginhome-5309: an agent can tell "the plugin is in the person's folder, not mine" (kosmos#5309, slice 1)

## Problem
A day-one report: a CRM plugin installed and enabled in the person's own app never reached their agents, even after
restarts, and nothing could tell them why. Kosmos installs no plugins. A Claude agent reads `CLAUDE_CONFIG_DIR` (unset only
for the default account), and a Codex agent reads `CODEX_HOME`. Each config folder keeps its own
`plugins/installed_plugins.json` (measured on Agent1s: `~/.claude` and an account folder hold different files).

## Change
`engine/connections.js` `blockBody()`: a new section, "A plugin the person installed in their own app", placed before
the Connections tab section. It names the two things that decide whether an agent gets a plugin, both checkable by the
agent itself:
- **its folder**: Claude `CLAUDE_CONFIG_DIR` or `.claude` in the home folder; Codex `CODEX_HOME` or `.codex` (Windows:
  the user's own folder). A second-account agent runs from its own folder.
- **its account**: claude.ai connectors come with the signed-in Claude account, not a folder; never on an API key.
Then it says to name which one it is plainly, rules out a restart for the other-folder/account case only, and lists the
in-folder causes (switched off, one project only, added after start where a restart IS the fix, a sign-in still needed).

Knowledge only: the block stays constant (no argument, no machine state), as its tests require. It deliberately names no
file inside a provider folder: where Codex records an enabled plugin, and how account-synced Claude plugins arrive, were
not measured (review iteration 1).

## Tests
`engine/connections.test.js`: one new test pinning the section's facts, its position before the Connections tab
section, and no em dash. Red-capable: with origin/main's connections.js substituted in (`git show origin/main:engine/connections.js`), `node --test
engine/connections.test.js` gives 10 pass, 1 fail; with the change 11/11.
Related files (`node --test server.connections-refresh-1649.test.js engine/connections.test.js engine/discover.adopt.test.js
engine/create.test.js`, from the worktree): 263/263 at the first commit. Full validation: Mortals, at the final head.
- A default agent's folder is not always `~/.claude`: bin/agent-supervisor.sh passes a tmux-global CLAUDE_CONFIG_DIR into
  the pane when one is set (EFFECTIVE_CCD), so the text tells the agent to compare folders, not infer from the account.

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
