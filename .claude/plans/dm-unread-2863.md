# Plan: a.dmUnread engine prerequisite for #2863 (DM-notification badges)

Author: Angel. Started 2026-09-11 23:01 CDT. Branch: dm-unread-2863.

## Why
#2863 (Mona Lisa's card) renders red numbered DM badges + an agents tally on the
board. Her render half is ready but blocked on an engine field: the fleet payload
carries `state` + `needsYou` per agent, but no per-agent unread-DM count. This
branch adds that field and its clear, mirroring the existing project-unread
precedent so the two read as one product. The render half stays Mona's.

## Contract (from Mona's #2863 comment)
- Add `a.dmUnread` (integer) to each agent in the fleet payload = count of unread
  replies FROM that agent in the operator's 1:1 DM channel.
- Expose a per-agent `/seen`-style clear that zeroes it on read, mirroring the
  project `/seen`.

## Engine facts verified (not assumed)
- The operator<->agent DM ("your 1:1 DM channel") is the chat.js DIRECT store,
  NOT messages.jsonl. `/api/reply` (the #175 reply path, server.js:8065) records
  an agent's reply via `chat.appendMessage(chat.DIRECT, who, {text, at, from: who})`.
- DIRECT threads live one-file-per-agent at `chats/direct..<key>.json`
  (chat.js:1612). In a thread, a message's `from` ABSENT = the operator; a present
  string `from` = the agent's reply (chat.js:1666-1669). So "unread replies from
  that agent" = messages with a present string `from`, newer than a per-agent
  read cursor.
- Precedent to mirror (project side): messages.js `room-seen.json` +
  `seenRead()`/`markSeen()`/`unreadAll()`; server.js `withUnread()` (1488) adds
  `unread` per project; route `POST /api/project/<id>/seen` (10080) ->
  `messages.markSeen(id)` responding `{seen, unread:0}`.
- No unread/seen concept exists in chat.js today (fresh add).
- Counting-from-record (no explicit increment/counter) is the precedent and is
  correct here: the reply path already appends to the DIRECT thread, so a
  count-from-thread reflects new replies automatically and cannot drift. So the
  #175 reply path itself is NOT modified.

## Changes
### engine/chat.js
- `DM_SEEN = path.join(store.ROOT, 'dm-seen.json')`, per-agent cursor `{[agent]: ISO}`, sibling of room-seen.json.
- `dmSeenRead()`, mirror messages.seenRead: ENOENT -> {}, unreadable/bad-shape -> null.
- `markDmSeen(agent, now)`, mirror messages.markSeen: validate name, atomic tmp+rename, return kept ISO.
- `dmUnreadAll()`, enumerate `chats/direct..<key>.json`, read each via readThread(DIRECT, key), count messages with a present string `from` and `at` > dmSeen[agent]. Return `{[agent]: n}`. Divergence from the room precedent, documented in-code: a single UNREADABLE/UNPARSEABLE thread sets that agent's value to `null` (unknown, not zero) rather than nulling the whole map, DIRECT threads are independent files, unlike the one shared room log. Whole-map null only when the seen cursor or the chats dir itself is unreadable.
- `dmUnread(agent)`, single-agent convenience.
- Export all five + DM_SEEN.

### server.js
- `withDmUnread(agentList)` near `withUnread` (1488): compute `chat.dmUnreadAll()` once (catch -> null), map each agent to `{...a, dmUnread: counts === null ? null : (a-key in counts ? counts[key] : 0)}`, where a per-agent null in counts passes through. Key by the agent's roster name (sessionName/name).
- Apply at the board payload (server.js:2492): wrap `agents.concat(offline)` with `withDmUnread(...)`.
- New route `POST /api/agent/<name>/seen` mirroring the project /seen (near 10089): decodeSegment, `chat.markDmSeen(name)`, respond `{seen: at, dmUnread: 0}`.

### Tests
- engine/tests (node --test): chat.dmUnreadAll counts only present-from messages, respects the cursor, per-agent-null on a damaged thread, whole-null on unreadable cursor/dir; markDmSeen round-trips + zeroes the count.
- server route test: POST /api/agent/<name>/seen moves the cursor; the board payload carries dmUnread per agent.

## Verification
- `bash tools/run-tests.sh` DIRECT (not piped), assert real exit 0 + expected suite count.
- No web/index.html render change -> no browser-check needed (Mona owns the render); no Playwright required this session.
- /challenge-loop to convergence -> proof file -> PR (Addresses #2863, non-closing; no --reviewer per the self-authored-Kosmos-PR rule). Ping Mona when a.dmUnread lands.

## Weakest premise
That "unread replies from that agent" means present-`from` messages in the DIRECT
thread. If Mona/Josh intend dmUnread to also count agent->agent peer chatter or
room mentions, the source set widens, but her comment says "your 1:1 DM channel,"
which is exactly the DIRECT store, so present-`from` in DIRECT is the reading.
