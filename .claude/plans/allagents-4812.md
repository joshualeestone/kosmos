# allagents-4812: the Agents view lists the agents of all your computers (board half)

Card: joshualeestone/kosmos#4812. Design: card comment 5923101367 (option A, browser-side). Relay half:
kosmos-relay `siblingcors-4812` (a computer answers `GET /api/status` to a LISTED sibling origin of its own
account, with CORS and its board token, only for a browser it already lets in).

## What this changes
- `engine/account-computers.js`: `parseComputers` passes the coordinator's `last_seen` through as `lastSeen`
  (seconds, or null). Nothing else about the route changes.
- `web/index.html`: a section below the agent cards, "Your other computers", one group per OTHER computer:
  - Read by THIS BROWSER from `https://<address>/api/status` with `credentials: 'include'`, never by the board.
    The card's rule: each computer decides who reads it. A browser that computer has not let in gets its
    gate's answer, and the group says so, with no agents.
  - Only on a page served from this computer's own Kosmos+ address (`location.hostname` equals the row marked
    `this`, over https). Anywhere else (the app's 127.0.0.1 board, a LAN address) the browser cannot read a
    sibling at all, so the section is absent and the view is today's.
  - Cards are READ-ONLY and separate from `LAST`. Every button on today's cards acts on THIS board's engine;
    putting another computer's agents in `LAST` would let Restart or Remove act on the wrong computer. Each card
    is a link that opens the agent on its own computer: `https://<address>/?agent=<sessionName>` (the existing
    deep link). Marked with the computer's name.
  - Sorted with today's sort (`sortAgents`, `AGENT_SORT`), projects empty (they are this board's).
  - Unreachable (network error, timeout, 5xx): the last list this browser read from it, greyed, with "Last seen"
    from the coordinator's `lastSeen`. Never read before: the group says not connected, with Last seen.
  - "This computer only" checkbox, remembered per browser (`kosmos.agents.thisOnly`), hides the section.
  - Reads: computers every 60 s (the route probes each computer), each other computer's status every 15 s,
    each read cut at 10 s, only while the tab is visible and the Agents tab shows.

## Decided, and rejected
- Rejected merging into `LAST`/the main grid: wrong-computer actions (above). The cost: other computers' agents
  sit in their own groups, not interleaved by the sort.
- Rejected a board-side read (board signs, asks siblings): a new computer-reads-computer trust path the card
  forbids (design option B).
- Rejected showing the section in the app's 127.0.0.1 board with a "sign in" link per computer: the page cannot
  read them from there whatever the person does. The app loading its own Kosmos+ address is the separate piece.

## Weakest premise
That `/api/status` from another computer can be rendered safely. It is that computer's own data, but this page
treats it as untrusted: every string goes in through textContent, every URL is built from the coordinator's
validated address (computerAddressOk) and an encoded sessionName, never from the answer.

## Tests
- engine: lastSeen passed through, null when absent or not a number (control: a number passes).
- web unit (lifted functions): eligibility (own address over https only; 127.0.0.1, http, another computer's
  address refused), classification (200 json with agents = ok; 401/403 or non-json = not let in; throw/abort/5xx =
  unreachable), a stale list kept and greyed on unreachable, dropped on not-let-in, link building (encoded, from
  the address not the answer), textContent only (an agent named `<img onerror>` stays text).
- browser check: the section with two fake siblings (one ok, one unreachable with a kept list), light/dark,
  desktop/phone; absent on 127.0.0.1.
