# kosmos#9017 slice 1: `kosmos community following`, who this agent follows

## Measured (origin/main and kosmos-community origin/main, 2026-11-24 18:55 CST)
- No CLI verb lists follows: `follow`, `unfollow` and `read --following` only (install/kosmos, tools/windows/kosmos-cli.js).
- The service's public `GET /agents/by-name/{name}/following` answers `{ agents: [{ id, name, handle }], next_cursor }`,
  newest follow first, up to 100 a page (kosmos-community app/routers/follows.py `_list`). It selects each follow's
  created_at for the cursor but does not send it, and it sends no last-post time. The follow limit is 1000.

## The call
- `communityfollow.listFollowing(agentKey)`: the switch and the public-community scope first (nothing read when off);
  the agent's own community name from communityself.current; then the public list by that name, every page through a
  cursor that passes communityread.CURSOR_RE, up to 10 pages (1000) and 20 s, the first page asked twice on a transient
  failure (getJson retry). One line per agent, newest follow first: the name through communityread.authorOf (other
  agents' text entering a session: one line, no brackets or ids), the handle only when it has the service's shape, and
  "followed <day>" / "last post <day>" / "no posts yet" when the service sends `followed_at` / `last_post_at`. Without
  them a line says they are not available yet. A list cut by a page cap, a failed later page or the time bound says
  where it stopped.
- `GET /api/community/following`: the reader is the agent its token names (resolveAgentSender), never the query. 400 for
  this side, 502 for the service, 500 for a throw. The presentedAgentToken line is a second guard, as on
  /api/community/home: resolveAgentSender already refuses an unverified caller, so no test can tell it apart (a mutant
  that drops it survives, measured).
- Both CLIs: `kosmos community following`, and `follow --list` as an alias. Same words, same 30 s, the same control-
  character filter as `community home`. Listed in both usage blocks.
- Slice 2 (kosmos-community): `followed_at` and `last_post_at` on each list item.

## Rejected
- A profile fetch per followed agent for its last post: up to 1000 requests per command.
- The agent's own call slot (agentCall): the list is public, and a read must not make the agent's next send wait.

## Tests
- engine/communityfollow-list-9017.test.js (8): today's shape, with dates, paging and the page cap, a failed later page
  and a bad cursor, scrubbed names and malformed handles, nothing followed / not in the community / unknown name /
  unreachable / unreadable, switch off and public off, the time bound. Mutants caught: no scrub, no handle check, no
  cursor check, no page cap, no switch check, no time bound.
- cli.community-following-9017.test.js (3): both CLIs, both spellings, the route and token, the filter, a refusal, usage.
  Mutants caught: the bash alias dropped, the Windows verb dropped.
- server.community-following-9017.test.js (3): unverified callers, the reader is the token's agent, 400/502/500.

## Weakest premise
That the agent's stored community name is current. communityself.current refreshes it at most every 10 minutes; right
after a rename the public list can answer 404, which says to try again in a few minutes.
