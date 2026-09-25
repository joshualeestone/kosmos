# guide-create-3734: the setup guide makes agents for the person

Card: kosmos#3734. Josh, 2026-09-25 08:23 (#admin 1553034280500854875): he asked the guide for a project
manager and it refused; "we should just allow it to go ahead and make agents for me". Splinter routed it to
Renet, ahead of the #3660 fallback.

## What
- **The route.** `POST /api/agents` from an AGENT (it presents its launch token) is accepted only from the
  setup guide (`agentCreateAllowed` in `server.js`: the token's agent must be `setupGuideNow()`'s name). Any
  other agent, or a token that names no agent, gets a 403 before anything is made. The guide is bounded at
  `GUIDE_CREATES_PER_HOUR` (6) creates an hour (in memory), a 429 naming New agent. With no provider named,
  the new agent runs on the guide's own provider. It then goes through the same create path as New agent, so
  the defaults are identical. The answer carries `madeBy`. The screen and a tokenless caller are unchanged.
- **The verb.** `kosmos agent create "<name>" <role>` posts with `KOSMOS_AGENT_TOKEN` and says what the board
  answered (made, with the board link; refused, with its reason; partly made). `kosmos agent roles` lists role
  keys from `/api/roles`. The answer is parsed as JSON, never grepped.
- **The role.** `engine/roles.js`: making agents is split out of `SETUP_HANDS_OFF` into `SETUP_MAKES_AGENTS`.
  Settings stay hands-off. The guide is told to say in one line what it will make and ask the person to
  confirm, and only after a yes to run the verb, then give the link, or the refusal's reason.
- **Existing guides.** `setup-assistant.refreshGuideRole()` runs once at board start and replaces the
  pre-#3734 "you never create agents" paragraph with the current lines, only in the marked guide folder, only
  when the paragraph is there word for word (a person's own rewording is left alone), and version-checked.

## Decided, and why
- Identity by the launch token, not the pane: `from_pane` is advisory, and this is a permission.
- Confirm-first lives in the guide's instructions (the card's "confirm in one line"), not in a server
  round-trip: the confirmation is a conversation turn, and the bubble needs no new button.
- The provider defaults to the guide's own, the one the person connected and the guide is answering on.

## Weakest premises
- **A running guide reads its new instructions from its next session.** Josh's guide was running when he
  asked; after this ships, it takes a restart (or a fresh start) before it knows it may make agents. A guide
  made after this ships knows from birth.
- The guide's account is not recorded in its profile, so only the provider is inherited. A guide on a
  non-default account makes agents on that provider's default account. If that account is dead, create's own
  check refuses with its reason, and the guide passes it on.
- The link is the board's address, not the new agent's page.
- The hourly bound is in memory, so a board restart resets it.

## Verification
- `server.agent-create-guide-3734.test.js`: the guide makes one (with `madeBy`); another agent and a junk token
  get a 403 and nothing is made; the screen is unchanged; the bound gives a 429 for the guide and not for the
  screen; the guide's provider is used.
- `engine/setup-assistant.role-3734.test.js`: the rewrite runs once, never outside the guide, and leaves a
  reworded paragraph alone. `engine/roles.test.js`: the lines follow their switches.
- `cli.agent-create-3734.test.js`: token, name and role reach the board; made, refused, and engine-refused
  answers; roles; a bad call never reaches the board.
- Mutations, all red: any agent allowed, no bound, no provider default, the rewrite outside the guide, the
  CLI dropping the token.
