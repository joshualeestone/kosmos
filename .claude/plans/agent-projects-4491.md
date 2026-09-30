# agent-projects-4491: #4491 slice 5b, an agent that makes a project is named as its maker and is on it

Card: joshualeestone/kosmos#4491 (claimed:angel). Built on slice 5a (`agent-writes-4491`: task add and task close)
and slice 4 (`agent-reads-4491`: the three reads). Stacked on those until they merge; then rebased onto main.

## Finished looks like
1. `POST /api/projects` (`kosmos project create`) names its caller the way the task verbs do (the agent token,
   else the pane as a roster target or through `messages.resolveSender`).
2. When the caller is an identified agent, the project's record says it made it (`made.by`) and it is ON the
   project, together with any members the request names.
3. Both CLIs send the agent's own token on `kosmos project create`, plain hex only, and still send the board token.
4. The route is still opened by the board token. An agent token alone does not make a project.
5. The page, and a caller nobody can name (the person's terminal outside tmux), make exactly what they made before.

## Why
Every agent's working rules say (engine/defaults.js, "Making a project"): "You can make a project yourself ... it
exists on the board with your name on it ... Once it exists you post to it and hand it work the same way as any
other project." On main none of that holds for the agent that made it: the project lists nobody, records no maker
(the board compared the pane with a roster target, which the CLI's `%N` never equals), and its room refuses a post
from an agent the project does not list. Slice 5a added a rule that an agent adds tasks only to a project it is on,
and had to carry an exception for these memberless projects. This slice makes the instruction true.

## Decisions
- **The maker becomes a member, only when it is identified.** Rejected: recording the maker without putting it on
  the project (the room and task rules would still refuse it); and putting an unnamed caller's pane session on the
  project (a stranger's session is not an agent).
- **Members the request names are kept; the maker is added after them, once** (`projects.create` already removes
  duplicates).
- **The page's request is never touched.** The person ticks who is on the project; the person is not an agent.
- **A token the board cannot resolve makes nothing (403), and is never swapped for the pane.** A token with an
  unreadable roster is a 503. A caller with no token and an unreadable roster is unnamed, and the project is made
  with nobody on it, as before. Same rules as slice 5a, from the same helper (`processCaller`).
- **The gate is not opened.** `POST /api/projects` stays out of the agent-token routes. A project is pointed at a
  folder the caller chooses and Kosmos writes into it, so letting a caller that holds ONLY its own token (a Claude
  setup guide on a Mac, an agent behind a reverse proxy) make projects is a separate decision, left for the slice
  where the CLIs stop sending the board token.
- **Slice 5a's exception stays, reworded.** Projects agents made before this slice still list nobody. They keep
  taking tasks from an identified agent (the exception), so nothing that works today stops. New agent-made
  projects never need it. Rejected: deleting the exception now, which would refuse an agent a task on a project
  it made last week.

## What changes for callers that work today (stated)
- A project an agent makes now has that agent on it: it shows on the project's member list on the page, the agent
  is told about the project like any member, and it can post in its room.
- As in slice 5a: a stale or unresolvable `KOSMOS_AGENT_TOKEN` now turns `kosmos project create` into a 403, and
  a token with an unreadable roster into a 503, where before the CLI sent no token.

## Known limits
- Advisory, as every slice: a caller holding the board token can send no token and no pane and make a project
  with nobody on it.
- A paneless maker (a Windows agent, a token with no roster row) is listed under the token store's key, which can
  differ in spelling from its name.
- `kosmos room reopen` is not touched. It clears the loop-guard that exists to stop agents, so whether an agent's
  own token may do it is its own decision (the next slice).

## Weakest premise
That an agent which makes a project should be on it by default. The instruction text says so in as many words, but
nobody has ruled on a lead agent that sets up projects for others and does not want to be in their rooms.

## What would change this
- Josh wanting a maker NOT on the project: drop the two lines that add it; `made.by` still records who made it,
  and slice 5a's exception keeps its tasks working.

## Tests
- `server.agent-projects-4491.test.js` (new, 6), projects made for real in the sandbox: an agent's token names it
  as the maker and puts it on the project, after which it adds a task and reads the room on its token alone while
  another agent is refused both; a pane names the maker too, and named members are kept with the maker listed
  once; a terminal with no pane and the page make exactly what they asked for; an unresolvable token makes nothing
  and is not swapped for a pane; an agent token alone is refused at the gate; with an unreadable roster a token
  makes nothing (503) and a tokenless caller makes an unstaffed project as before.
  Measured red, one mutation each: the maker not added; the caller not named; the gate opened to a token alone.
- `cli.agent-token-verbs-4491.test.js` (2 new): `kosmos project create` presents a valid token and still the board
  token, and forwards nothing for a junk or absent one. Red against slice 5a's CLI.
- `tools.windows-kosmos-cli-writes-4491.test.js` (1 new): the same on Windows. Red against slice 5a's CLI.
- Pins updated on purpose: tools.windows-kosmos-cli-570 (project create presents the agent token); the slice-4
  Windows control verb is now room reopen.
- All 192 test files that touch project creation, the gate, the CLIs or the guide: 3666 pass, 0 fail.

