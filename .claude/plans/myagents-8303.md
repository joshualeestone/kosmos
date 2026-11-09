# kosmos#8303: My Agents

Josh's hand-edited mock of the agent page: a collapsible list of all agents down the far left, so you can jump from agent
to agent. Starred first, + to make one, one group, no "All agents" link above the agent, org chart kept.

## The call

A new column on the agent page, in both layouts. On the one-screen layout, opening an agent leaves that layout, so the
existing Agents rail is not on the agent page at all; the mock draws it there. So this is not a change to that rail, and it
does not touch #8302.

- Each row is the board's own list row (lrow), restyled. One definition of what an agent row shows: name, role, avatar,
  star, unread count. Clicks go through the board's own handler, so stars and answering work the same.
- Order is sortAgents with the stars, the same order as the board.
- + starts the same New agent as the board's button. The fold is remembered per browser.
- Windows narrower than 1100px do not show it and keep the "All agents" link: there is no room for both columns.
- With the column showing, the "All agents" link goes. An agent opened from a project keeps the link naming that project;
  the mock crossed out only "All agents".
- The org chart stays on the board, reached by the Agents tab.

## Rejected

- A fourth sort or view, as Josh wondered. Sorts order one list and views live on the board page; this is a way of moving
  between agents while on one.
- Reusing #alist and #rail-agents by making the agent page part of the one-screen layout. That grid and its panel moves are
  built around the projects column, and it would not reach the tab layout.

## Weakest premise

That 1100px is the right floor. Below it the agent page's own two columns need the room. It is one constant.

## What would change this

Josh wanting it on narrow windows or the phone, or wanting the column on other pages than the agent page.
