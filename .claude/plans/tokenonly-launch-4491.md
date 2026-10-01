# #4491 slice 9: the supervisor puts the token-only switch into ONE agent's launch, from a setting

## Finished looks like
The person can list agents in `<store root>/agent-token-only.json` (`{ "agents": ["<roster name>"] }`), and the next
launch of a listed agent (the Mac supervisor) carries `KOSMOS_AGENT_TOKEN_ONLY=1` beside its own minted token, in the
one-use secrets file (never tmux argv). Its CLIs, report hook and bridges (slices 7 and 8, on main) then present its
own token alone. Every other agent, and every agent when the file is absent or broken, launches exactly as today.

## Pieces
1. `engine/sendertoken.js` `tokenOnlyFor(name)` / `tokenOnlyFile()`: reads the setting lazily under store.ROOT;
   matches the roster name EXACTLY (not safeKey, which two names can share, #4792); anything unreadable or wrongly
   shaped is false.
2. `bin/agent-supervisor.sh`: right after the token joins SECRET_ENV, ask tokenOnlyFor(roster name); "1" adds
   `KOSMOS_AGENT_TOKEN_ONLY=1` to SECRET_ENV. Only beside a real token; any failure leaves it off and the launch goes on.

## Decisions
- A file, not a Settings toggle: this is a pilot for one agent ("watch that agent work for a while before any more").
  A toggle comes if the pilot holds. Weakest premise: an agent on the same Mac user can edit the file and turn its own
  switch off; that only returns it to today's behaviour, which every agent has now, so it loses nothing.
- Exact roster name, so a `-discord` session of a listed agent gets it (the roster name strips the suffix) and a
  differently-cased name does not.
- Mac supervisor only. Windows launches, and remote/paneless agents, are not covered by this slice.

## Tests
- `engine/sendertoken-tokenonly-4491.test.js`: listed/unlisted, exact match vs safeKey neighbours, broken files, bad names.
- `tools/test-supervisor-env.sh` #4491 arm: real supervisor and real mint in a sandbox: listed gets token + switch in
  the secrets file and not argv; its -discord session too; an unlisted agent gets the token only; a wrongly shaped
  setting is off and the agent still starts.
