# newagent-7488: TestFlight build 13 (native New Agent, and "Create" on New project)

## Finished looks like

- #7488: + on Agents opens a native sheet, at once, with the desktop's first screen: Create a Single Agent, Create a Team of Agents, and Create a Swarm of Autonomous Agents when the board says swarms are on. Each one leads to a native flow that creates the agent(s) on the connected computer, in the desktop's words (Mona Lisa's phone design on the card), and it fits the smallest phone.
  - Single: What should this agent do? (the recommended role, Pick another role grouped from /api/roles, Describe it yourself), then Set up your agent (Name, Role, Reports to, Model), Create, Making it, Say hello, which opens the agent's chat.
  - Swarm: the same without the recommended Project Manager, plus Maximum helpers and the Daily usage limit.
  - Team: Pick a ready-made team, its members lead first (names editable), Project (optional), Model for every agent, Create N agents, the members made lead first, Go to your team (the lead's chat).
- #7489: the New project button reads "Create" on every size, so the title is not cut short on the smallest phone (Mona).

## Decided

- **Every list comes from the board's routes** (/api/roles, /api/teams/seeded, /api/projects), and every request is the desktop's own (POST /api/agents with the desktop's body; the specs route for a team). The phone never keeps its own copy of a role, model or team.
- **No provider or account picker in this build.** The board's default account and the Claude models /api/roles serves. Weakest premise: a person with only OpenAI connected gets the board's refusal sentence rather than a choice; the provider picker is the next slice if that bites.
- **A swarm's limit is in tokens a day** (the desktop's token mode). The desktop switches to a share of the weekly allowance when the chosen Claude account is calibrated; the phone does not read that calibration yet.
- **Say hello waits for the agent to appear in the phone's list** (read every 5 s, as the desktop waits for /api/status). After 30 s unseen the screen says the desktop's "has not come up" and offers Done, not hello, as the desktop does; the list keeps being watched, so hello appears if the agent comes up later.
- **Agents made into a project are told about it** once the board sees them (POST /api/project/<id>/agent/<name>, the desktop's tell). Team portraits are not set by the phone in this build (the desktop uploads the catalogue's picture or a generated mark).
- **A project tell is sent once, when the phone's list first shows the agent, and not retried** (the desktop's fire-and-forget): if the phone is not connected at that moment, the tell is not sent, and the project's own screen shows the stored verdict.
- **Duplicate names inside a team** are refused by the board's own name check, in its words; the phone does not check them a second time.
- **Team names are editable on the preview**, because the board refuses a name already taken and the person must be able to change it.
- The team's button reads the desktop's "Create N agents", not "Create the team" (Mona's note named the desktop's words as the rule).
- Not on the phone in this build (Mona's design): import an agent, upload an org chart.

## Not verified

- Not run on a device, and not sent against a real board: shown through simulator shots with Debug sample hooks.

## Reviews

(filled in by the challenge loop)
