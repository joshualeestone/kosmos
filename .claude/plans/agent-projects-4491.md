# agent-projects-4491: an agent that makes a project is named as its maker and is on it (#4740)

Card: joshualeestone/kosmos#4740 (claimed:angel), found while building #4491 and first called its "slice 5b". It has
its own card because it is a change to what an agent-made project IS, not to which token opens a route. Built on slice 5a (`agent-writes-4491`: task add and task close)
and slice 4 (`agent-reads-4491`: the three reads). Stacked on those until they merge; then rebased onto main.

## Finished looks like
1. `POST /api/projects` (`kosmos project create`) names its caller the way the task verbs do (the agent token,
   else the pane as a roster target or through `messages.resolveSender`).
2. When the caller is an identified agent, the project's record says it made it (`made.by`). Unless it is the
   setup guide, it is also ON the project, together with any members the request names.
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
- **Never the setup guide (round 1).** The page keeps the guide out of every list of agents, and a member is sent
  every post in its room. A guide that can reach this route (one that is not sandboxed holds the board token) is
  recorded as the maker of a project it makes and is NOT put on it, which is what happened before this slice.
- **The maker is not typed at, and is not told to ask for a brief (round 1).** Telling a member at create means
  syncing its instructions, typing a line into its pane, and, when the project has no brief, posting the
  agents-only "one of you ask what the goal is" note. For the maker: the sync stays (it is what makes the
  membership real), the pane line is skipped (the CLI has just told it; and create records no member change, so
  the line would sit outside the member valve and a looping agent could type into itself as fast as it creates),
  and the note needs a member other than the maker. A member the maker names is told exactly as before.
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
  taking tasks from an identified agent (the exception), so nothing that works today stops. New projects made
  by an ordinary agent never need it; projects made by the setup guide, or by a caller nobody can name, still
  list nobody and still rely on it. Rejected: deleting the exception now, which would refuse an agent a task on a project
  it made last week.

## What changes for callers that work today (stated)
- A project an agent makes now has that agent on it: it shows on the project's member list on the page, its
  instructions list the project (it is not typed at), it is sent the posts made in that room, and it can post
  there.
- The clock's Assigner does NOT start working such a project: an agent alone on a project it made is not handed
  its tasks or asked about its goal, exactly as before (when the project listed nobody). With anyone else on the
  project, the maker is an ordinary member and the Assigner works it as it works any staffed project.
- As in slice 5a: a stale or unresolvable `KOSMOS_AGENT_TOKEN` now turns `kosmos project create` into a 403, and
  a token with an unreadable roster into a 503, where before the CLI sent no token.

- A pane that is a roster target no longer names the maker unless that row is tied to our agent (`isNamedOurs`),
  as the task verbs require since slice 3 and 5a. Before, any roster row with that target was recorded as
  `made.by`. A stranger's session is no longer recorded as an agent.
- The person typing `kosmos project create` inside an AGENT's tmux pane is, to the board, that agent: the agent is
  recorded as the maker and put on the project. The board cannot tell the two apart (the same is true of every
  pane-named verb). The person removes it on the project's page if that is not what they wanted.

- The maker's card can read "Kosmos changed its instructions, and told it on its screen" after it makes a
  project. Nothing was typed by Kosmos; what was on its screen is the CLI's own "Created project ..." line. It
  does know, so the restart prompt that sentence suppresses would be wrong too. Stated, not changed.

## Known limits
- Advisory, as every slice: a caller holding the board token can send no token and no pane and make a project
  with nobody on it.
- A paneless maker (a Windows agent, a token with no roster row) is listed under the token store's key, which can
  differ in spelling from its name.
- The maker's instructions are synced like any member's, and like any member's that can fail (measured: a maker
  with no folder on this computer gets "it has no folder of its own on this computer yet"). The membership stands
  and the create still answers 200 with that verdict in `told`, which is the route's existing rule for a member it
  could not tell.
- `kosmos room reopen` is not touched. It clears the loop-guard that exists to stop agents, so whether an agent's
  own token may do it is its own decision (the next slice).

## Weakest premise
That an agent which makes a project should be on it by default. The instruction text says so in as many words, but
nobody has ruled on a lead agent that sets up projects for others and does not want to be in their rooms.

## What would change this
- Josh wanting a maker NOT on the project: drop the two lines that add it; `made.by` still records who made it,
  and slice 5a's exception keeps its tasks working.

## Tests
- `engine/assigner.test.js` (1 new): the maker alone on its own project gets no task and no goal ask; the same
  project is worked when the person made it, when another agent made it, and once a second member is on it.
  Measured red with the skip removed.
- `server.agent-projects-4491.test.js` (new, 9), projects made for real in the sandbox: an agent's token names it
  as the maker and puts it on the project, after which it adds a task and reads the room on its token alone while
  another agent is refused both; a pane names the maker too, and named members are kept with the maker listed
  once; a terminal with no pane and the page make exactly what they asked for; an unresolvable token makes nothing
  and is not swapped for a pane; an agent token alone is refused at the gate; with an unreadable roster a token
  makes nothing (503) and a tokenless caller makes an unstaffed project as before.
  The maker alone is not typed at and gets no brief note, while a member it names is and the page's create is as
  before; the setup guide is recorded as the maker and not put on the project, while another agent is.
  Measured red, one mutation each: the maker not added; the caller not named; the gate opened to a token alone;
  the maker typed at; the brief note posted for a maker alone; the guide put on its project.
- `cli.agent-token-verbs-4491.test.js` (2 new): `kosmos project create` presents a valid token and still the board
  token, and forwards nothing for a junk or absent one. Red against slice 5a's CLI.
- `tools.windows-kosmos-cli-writes-4491.test.js` (1 new): the same on Windows. Red against slice 5a's CLI.
- Pins updated on purpose: tools.windows-kosmos-cli-570 (project create presents the agent token); the slice-4
  Windows control verb is now room reopen.
- Every test file that touches project creation, the gate, the CLIs or the guide is re-run after each round; the
  tally of the last run is in the proof.

## Review round 1 (opus): 0 BLOCKER, 4 WARNING, 1 CONVENTION, 3 NIT
- W the "no brief yet" room note fired for a maker alone on its own project: it now needs a member other than the
  maker. Tested.
- W every create typed a line into the maker's pane, outside the member valve: the maker is not typed at; its
  instructions are still synced. Tested, with a named member as the control.
- W the setup guide was not considered: it is recorded as the maker and never put on the project. Tested.
- W "named members are kept and the maker added" was not pinned (the test named the maker itself): it names only
  another agent now, and a second case covers a maker that names itself.
- C the plan omitted the brief note and the `isNamedOurs` tightening, and the person typing in an agent's pane:
  all three are stated above.

## Review round 2 (sonnet): 0 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NIT
- W a maker with no roster row: the comment said its instructions "are still synced", which is not always so.
  Measured with the real route: the project is made (200), the maker is on it under its key, and the sync verdict
  for an agent with no folder here is "could not" with its reason; the membership stands, as for any member.
  The comment and plan say that now, and a test pins the case (and that the maker can then add a task).
  The reviewer's predicted reason ("no agent with exactly this name") is not what the route answers.
- C the exception's comment and the plan left out the setup guide as a third source of memberless process-made
  projects: added.
- NITs not taken: a trimmed-versus-untrimmed name comparison that cannot differ today; the guide is tested in its
  roster-name form only (the key form resolves the same folder).

## Review round 3 (opus), a pass around the change: 0 BLOCKER, 2 WARNING, 1 CONVENTION, 3 NIT
- W the Assigner (on by default) works any project an agent is on, so an agent-made project with a goal would now
  be driven by the clock with no person involved: it skips an agent alone on a project it made. Tested with three
  controls.
- W the maker's card can say "told it on its screen" though Kosmos typed nothing: declared (above and in the
  handler comment). Rejected: typing the join line into the maker's pane to make the sentence literally true
  (round 1 removed it for the loop it opens), and teaching the override about makers (a second rule about the
  same sentence in another engine).
- C "the agent is told about the project like any member" was stale since round 1: reworded.
- NITs: the guide comment says what its project lists; taken. Not taken: CLI tests for the two refusals on project
  create (both CLIs print the board's sentence and exit 1 through the same arms the task verbs' tests cover).
- Moved to its own card, #4740, in this round: the reviews showed this is a change to what an agent-made project
  is (membership brings the room, the Assigner, the member list), which does not belong inside #4491.

