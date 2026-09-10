# kosmos-task-2662 -- surface the per-project tasks feature to agents

## Problem (#2662)

The board already exposes a per-project tasks API (`GET /api/tasks?project=<id>`,
`POST /api/project/<id>/tasks`, `POST /api/project/<id>/task/<n>/close|reopen`), but it was
not reachable from the terminal and agents were not told it existed. So agents improvised a
shared `task-board.md` file per project and collided on it. This surfaces the real feature.

## Change

Two parts, one file each plus a test:

1. **`install/kosmos` -- new `kosmos task <list|add|close>` verb** (`cmd_task()`), dispatched
   like the other verbs. It mirrors `cmd_post`'s established idioms exactly:
   - board token via `kosmos_curl "$_bt" ...` (header written to a mode-600 temp file and passed
     `-H @file`, never on argv -- macOS `ps -ww -o args` exposes argv cross-account);
   - `board_token()` for an enforcing board, inert when empty (#1946);
   - hand-rolled bash-3.2 JSON escaping (no urlencoder / JSON tool in bash 3.2);
   - renders `list` with the app's own node when present, raw JSON as the fallback;
   - project-id kept path/query-safe with a `sed` slug pass;
   - `{"error":...}` bodies surfaced as the board's own reason; unreachable board -> clear message.

2. **`engine/projects.js` -- `blockBody()` teaches the verb** beside the existing "Post to
   everyone" line, so agents catalog work with the real tasks board instead of a hand-rolled
   file. Re-spliced on every membership change (like the post line), so existing agents learn it,
   not only newborns.

3. **`engine/projects.test.js` -- a test** pinning the taught wording in the injected block.

## Non-goals / decisions

- No new board endpoints; this only surfaces what the board already serves.
- `close` takes the task NUMBER shown by `list` (the board's own per-project numbering), not an id.
- Reuses `cmd_post`'s token/escaping/rc idioms verbatim rather than inventing new ones, so the
  security-sensitive token handling has one reviewed implementation.

## Test plan

- `engine/projects.test.js` passes (the taught-wording assertion).
- Full validation suite green.
- Installed-CLI behavior: `kosmos task list/add/close` against a running board; an unreachable
  board and an enforcing-board token path both give correct messages.
