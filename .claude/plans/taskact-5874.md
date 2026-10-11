# taskact-5874: `kosmos task activity` reads a task's conversation

Card: #5874 (split out of #5842, Mona Lisa). Owner: April (night shift shard).

## Traced (main @ checkout)
- The record: engine/taskchat.js `read(projectId, number)`, oldest first, each event `{ at, kind, ... }`.
- The route: `GET /api/project/<id>/task/<n>/activity` (server.js) answers `{ events, count }`. It is NOT in
  AGENT_TOKEN_ROUTE_PATTERNS, so a caller on an agent token alone is refused today, and it identifies no caller.
- The words: the page's `tkActPhrase(ev, p)` (web/index.html), names through `tkMemberName(p, sn)`: the project
  member's `name`, else the agent's card name, else the session name.
- The task CLI pattern: `kosmos task list` fetches JSON with the agent's token and prints with the app's own node
  (install/kosmos); the Windows CLI mirrors it (tools/windows/kosmos-cli.js), held together by
  tools.windows-kosmos-cli-verbs-parity.test.js.

## What
1. engine/taskactphrase.js `phrase(ev, nameOf)`: the page's tkActPhrase, one rule for every CLI. The page keeps its own
   function (the page cannot require); a test holds them to the same words for every kind the page knows, and fails
   when either gains a kind the other lacks.
2. The route: joins AGENT_TOKEN_ROUTE_PATTERNS as a READ. A caller on its token alone reads only a project it is on (the
   /api/tasks rule, same refusals); the page and the person's terminal are as before. With `?words=1` each event also
   carries `words` (phrase with names from projects.get's members, else the roster card's name, else the session name).
   Without it the answer is unchanged. With it (only the CLIs ask), an unknown project or task is said (404), as
   `kosmos task list` says an unknown project (#4891 N6); the page keeps its fail-soft empty list for an unknown task,
   which server.task-activity-768.test.js pins (#992).
3. `kosmos task activity <project-id> <task-number>` on the Mac CLI (install/kosmos) and the Windows CLI: validate
   before the health check, send the agent's token as `task list` does, print one line per event, oldest first:
   `<local date and time>  <words>`, each event's words on ONE line. No events: one plain line saying so.
4. Help text on both CLIs; the parity test learns the verb.

## Not here
- #5842's kept-sent / kept-dropped words: on Mona Lisa's branch (tkdrop-5842), not on main. Whoever lands second adds
  them to both phrase functions; the parity test will fail until both have them, which is the point.
- Paging or filtering the conversation.

## Weakest premise
That printing a task's whole conversation to an agent on the project is fine: the page already shows it to the person,
and the agent can already post into it (kosmos task message). An outside sender's words (a webhook task) are quoted as
`task list` quotes them, if any event carries them.

## Pinned tests this changes, on purpose
server.agent-token-sender-570 (the token-route patterns and the count of narrowing call sites, now 4),
server.agent-writes-4491 (its closed-neighbours list named the activity GET; the receipt GET stands in, still the
person's), tools.windows-kosmos-cli-570 and tools.windows-kosmos-cli-verbs-parity (the task subcommand list).

## Tests
- engine/taskactphrase test: page and engine produce identical words for a fixture of every kind; kind sets equal.
- Route test: token-only agent on the project reads; one not on it is refused; words=1 adds names; no token unchanged.
- CLI tests on both, against a real sandboxed board with a real fleet card (fixture-discipline): the lines in order with
  the member's card name, kept-sent and kept-dropped reaching the output, a task with nothing recorded, an unknown
  project and task said, usage errors, the help line, and Mac and Windows printing the same lines.
