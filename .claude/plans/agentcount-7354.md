# agentcount-7354: a per-agent count on the iPhone Agents list's avatars

Card: kosmos#7354 (split from #7342; Josh 10-27, Mona Lisa's design).

## Finished looks like

On a phone, an agent with something waiting shows a red count at the top right of its avatar, the counts add up to
the Mac's own waiting number for agents, and opening the agent's chat clears its count.

## Decided

- The card's option 1 (the Mac's count, so the rows add up by construction), with no Mac change: the Mac's waiting
  total (engine/status.js waitingTotal) is agents needing the person, plus each agent's unread replies (dmUnread,
  the guide's left out), plus the rooms' unread. The first two are per agent and already in /api/status, so each
  avatar shows (needs you ? 1 : 0) + dmUnread. The rooms' unread is not an agent's and shows on the Projects tab.
- Rejected option 2 (counting this phone's delivered notifications): it only knows what reached this phone and
  cannot add up to the Mac's number.
- Opening the chat moves the board's own read cursor (POST /api/agent/<name>/seen, server.js dmSeen), as the board
  does, so the count clears everywhere, not only on this phone. Replies that land while the chat is open are marked
  read too.
- Not updating: no count (an old number would read as current).
- Weakest premise: that the Agents tab's number on the phone is meant to be the agents' share. It shows the Mac's
  whole total today (rooms included), so with unread rooms the rows add up to less than the tab, by the Projects
  tab's number.

## Steps

1. BoardLogic: Agent.dmUnread and isGuide parsed; noticeCount; noticeWords; dmSeenRequest.
2. AgentsView: the red count on AgentAvatar (9+ past nine), in the VoiceOver label, none while not updating.
3. ChatView: mark seen on opening, and when unread replies arrive while open.
4. Sample agents carry unread counts for the shots. LogicTests with the Mac's sum as the check.

## Verify

LogicTests, iOS 16 simulator typecheck, server.ios-routes-6838.test.js (the new POST is a board route), shots.

## Review bound

Challenge loop to convergence. Merge on green (beta rule).
