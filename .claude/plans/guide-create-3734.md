# guide-create-3734: the setup guide makes agents for the person

Card: kosmos#3734. Josh, 2026-09-25 08:23 (#admin 1553034280500854875): he asked the guide for a project
manager and it refused; "we should just allow it to go ahead and make agents for me". Splinter routed it to
Renet, ahead of the #3660 fallback.

## What
- **The verb.** `kosmos agent create "<name>" <role> ["<why>"]` asks for a one-member team
  (`POST /api/team`, #1279) with the agent's launch token, and says what the board answered: made (with the
  board link), or refused with its reason. With no launch token it refuses before sending, and a timeout
  reads as "may have been made; look at the board", never as "not made". `kosmos agent roles` lists role keys
  from `/api/roles`. On the Mac the answer is read as JSON by the engine's own node (`kosmos_engine_node`),
  since an agent's PATH may have none. The Windows agent command has the same verb, with the long timeout
  (`tools/windows/kosmos-cli.js`).
- **The route, unchanged in its rules.** `/api/team` already takes the creator from the verified token,
  records `createdBy` and `purpose` at birth, caps what one creator keeps alive under a per-creator lock, runs
  the same live account check as New agent, and creates through the same engine `createAgent`. One addition:
  a member that names no provider, account or model runs where the asking agent runs (`creatorRunsOn`: the
  runner and account folder of its launch job, read together so they cannot disagree; with no job, the
  provider recorded at its birth). Only for an agent caller, not the screen. So the guide makes agents on the
  model the person connected, not on Claude by default. A member that names a model keeps the old default.
- **The role.** `engine/roles.js`: making agents is split out of `SETUP_HANDS_OFF` into `SETUP_MAKES_AGENTS`.
  Settings stay hands-off. The guide is told to say in one line what it will make and ask the person to
  confirm, only after a yes to run the verb, then give the link, or the refusal's reason.
- **Existing guides.** `setup-assistant.refreshGuideRole()` runs once at board start and replaces the
  pre-#3734 "you never create agents" paragraph with the current lines. It does this only in the marked guide
  folder, only when the paragraph is there word for word (a person's rewording is left alone), and
  version-checked.

## Decided, and why
- **Built on `/api/team`, not a new gate on `/api/agents`.** The first version gated `POST /api/agents` to
  the guide's token. Review round 1 showed that restricted one spelling, not the ability: `/api/team` already
  lets any agent that presents its token create agents, and a tokenless local request was never gated. It
  also lacked what `/api/team` has (provenance, a per-creator cap under a lock, the 503 on an unreadable
  roster). So the guide uses the existing agent-facing create path, the way #3405 gave agents `project create`
  over the existing route.
- **"Only the guide" is what the instructions say, not a permission.** Only the setup role names the verb.
  Any agent with a token could already create through `/api/team` before this change; this change does not
  widen that.
- Confirm-first lives in the guide's instructions (the card's "confirm in one line"): it is a conversation
  turn, and the bubble needs no new button.
- The creator default applies to any agent that builds a team (a PM on OpenAI now builds its team on
  OpenAI), not only the guide: a member that names nothing should run where the asker demonstrably works.

## Weakest premises
- **A running guide reads its new instructions from its next session.** Josh's guide was running when he
  asked; after this ships it needs a restart (or a fresh start) before it knows it may make agents. A guide
  made after this ships knows from birth.
- `/api/team` does not seed a first-agent home or attach projects (#1279's stated gaps). The guide is not
  anyone's first agent, and its instructions ask for no project.
- The link is the board's address, not the new agent's page.

## Verification
- `server.team-creator-runs-on-3734.test.js`: a member with no provider gets the guide's provider (refused
  naming OpenAI on an OpenAI guide; made on a Claude one); an explicit provider is kept; through the route the
  member also gets the guide's account folder; a member naming a model, and a screen request naming the guide
  as creator, are not moved; `creatorRunsOn` reads provider and account from the one job.
- `tools.windows-kosmos-cli-agent-3734.test.js`: the Windows verb's request, link, no-token refusal, timeout
  and refused-member answers.
- `cli.agent-create-3734.test.js` (sandboxed `KOSMOS_HOME` whose runtime is the only node): token, name, role
  and why reach `/api/team`; the made agent is named from `created[0]`; a board error and a refused member
  are said with their reason; roles; a bad call never reaches the board; with no runtime and no node it says
  so.
- `engine/setup-assistant.role-3734.test.js`, `engine/roles.test.js`.
- Mutations, all red: the rewrite outside the guide, the CLI dropping the token, a bare `node` in the parse,
  `agent` missing from the help list, the model check, the agent-caller check, the account line, and the
  provider read from the profile before the job.
