# Plan — #3388: `kosmos project create` CLI verb (0.6.89)

## The task
Give an agent one command to create a Kosmos project:
```
kosmos project create "<name>" <folder> ["<description>"]
```
so a project-create does not need a raw curl with the board address hand-resolved and the board token in argv (the fragile thing we do not want pasted into agent instructions). Assigned by Mona (trust channel). Rides 0.6.89, after the 0.6.88 trust fix.

## What finished looks like
- `kosmos project create "Name" /folder` POSTs `{name, folder, from_pane[, description]}` to the EXISTING `POST /api/projects`, presenting the board token OFF-ARGV, and prints the created project id; a refusal (bad field / the 12-per-hour #327 valve) is surfaced and exits non-zero; a malformed call prints usage and sends nothing.
- The Windows shim (`tools/windows/kosmos-cli.js`) has the same verb, so the verbs-parity test holds.
- Tests prove the request shape and each outcome against a real stub; the full node suite + `test:shell` stay green.

## Backend (no change)
`POST /api/projects` at `server.js:11895` already exists. Reads `name, folder, description?, parent?, agents?, from_pane`; tags a process caller `made.via='process'`; rate-valved at 12 process-made projects/hour (#327). Success 200 = `{project, told, id, agentsUnreadable}`; errors (400/429/500) = `{error}`. Verified against the engine before building.

## The change (pure CLI wrapper)
1. **install/kosmos** — `cmd_project` with a `create` subcommand, mirroring `cmd_task`:
   - validate the subcommand + its args BEFORE the health check (a malformed call is named even when the board is stopped);
   - one `board_token` read; POST via `kosmos_curl "$_bt" ""` (board token off-argv in a mode-600 header file, no agent token — a board write, like task add);
   - bash-3.2 hand-rolled JSON escaping (no jq), same as cmd_post/cmd_msg;
   - `|| rc=$?` on the substitution (not a bare assignment under set -euo pipefail, the #2321 lesson);
   - success REQUIRES the returned id (an answer with neither an error nor an id is not a create), so it never falsely claims "Created".
   - Wired into the dispatch case AND both help banners (the verb list has three indices: the dispatch `case`, the `--help` banner ~1809, the dispatch `*)` banner ~2188).
2. **tools/windows/kosmos-cli.js** — `projectCreate` + `USAGE.project` + `project` in `VERB_HANDLERS` (subcommandRequired) and `SUBCOMMAND_HANDLERS`. Board write => `{agent:false}` (board token, no agent token); `from_pane:''` (a Windows agent has no tmux pane). Required because the verbs-parity test holds every agent-facing Mac verb to the shim.

## Tests
- `cli.project-create-3388.test.js` — a real in-process http stub the CLI's own curl hits: asserts the POST endpoint/method/body (name, folder, description-when-given/absent-when-not), the success id report, the error path (exits non-zero, surfaces the reason — the load-bearing control), and arg-validation (usage, exit 2, nothing sent). Binds 127.0.0.1:0 so no real board is touched and the #327 valve is never burned.
- A `project create` case in `tools.windows-kosmos-cli-570.test.js` — asserts the shim sends the board token and NOT the agent token, the body shape, and the success/error/usage outcomes.

## Scope / gaps
- Only `create` (the assigned verb). No list/delete via this verb (list exists elsewhere; delete is an operator action).
- `agents`/`parent` are accepted by the endpoint but not exposed by this verb (a basic create; can be added later if asked).
- Mona writes the one-line instruction-block sentence to match the landed syntax (`kosmos project create "<name>" <folder>`).
