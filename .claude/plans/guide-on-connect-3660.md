# guide-on-connect-3660: the setup guide is created the moment the first model is connected

Card: kosmos#3660 (the kosmos side of when the guide exists). Builds on #3034 (PR #3666).

## The ruling
Splinter, 2026-09-24 19:06, on Renet's gap (#3660): create the setup-guide agent **the moment the first model is
connected**, during setup or later, **never at Giddy Up without a model** (it could not run and would sit broken on the
board). Until then the bubble runs on the hosted model (#3660, Ice Cream Kitty's endpoint); once the guide exists, the
bubble hands off to it. Josh's direction behind it: 16:05 (his avatar, speaks as the builder), 18:07 (the hosted plan).

## What this branch does
- `FIRSTRUN_AUTOCREATE_ENABLED` is now **true**, and it arms `ensureGuide()` instead of creating at Giddy Up.
- **Armed at Giddy Up** (`/api/first-run/complete` writes `setup-assistant-armed.json`). Only an armed install ever gets
  an automatic guide.
- `ensureGuide()` creates the guide when: the switch is on, the install is armed, it was never seeded, and a model is
  connected. It is called at Giddy Up and by a one-minute sweep at board start, which catches every later connect
  path (keys, and sign-ins that finish in the background) without a hook in each route.
- `firstConnectedModel()`: the first LISTED account in provider order (Claude, OpenAI, Gemini, Grok) that passes
  create's own `accountConnectable` gate. The guide is created **on that model**, so an OpenAI-only person gets a guide
  that can run.
- After a try that reached a live check and did not create (a listed but dead sign-in, a rejected key, a refused
  create), the next try waits 10 minutes, doubling each time, capped at a day: the Claude gate is a live `claude -p`,
  a real request on their account. Single-flight.
- "Don't show this again" (`setupAssistant.on` false) also means no guide agent is created later.
- Under `AGENT_WORKFORCE_DRY_RUN=1` (test boards only) it is off unless `AGENT_WORKFORCE_SETUP_GUIDE=on`: review round 2
  measured server.projects.test.js creating an unasserted "josh" guide in its sandbox; now 0.
- The role text says the guide was created when they connected their first model.

## Decided, and why
- **Armed, not merely "a model is connected".** Every install that predates this has models and no seed flag, so a bare
  check would put an agent called Josh on every existing board, Josh's own included, the moment this ships.
  Rejected: seeding existing installs too (nobody asked, and it drops an unexplained agent onto a working board).
- **A sweep, not a hook per connect route.** Sign-ins complete in background processes, and five-plus routes would each
  need the call; one sweep sees them all. Cost is the four account lists per minute until seeded, then one stat.
- **Provider order** follows Josh's 17:05 order (Claude, OpenAI, Gemini, Grok).

## Weakest premise
That an install which re-runs first-run later should be armed. It is (the route arms it), which means a person who
redoes onboarding on an old install gets a guide then. That seems right: they are setting up again.
Splinter's own: people may not mind an agent appearing right after they connect a model; the #3574 tour should point at it.

## Verification
- `engine.setup-assistant-3034.test.js`: the GATE pins the switch on; the WIRING GUARD pins no direct seed call in
  server.js, both `ensureGuide` calls behind the switch, and arming only in the first-run route (RED with the sweep's
  guard removed); `firstConnectedModel` order, named vs default, dead accounts skipped; `ensureGuide`: unarmed never
  creates, no model creates nothing, the first model creates on THAT model once, single-flight shared result, back-off
  with a control, switch off does nothing. Each RED under its mutation.
- `server.guide-on-connect-3660.test.js` (real server as a child, every root sealed): Giddy Up with a connected Claude
  account creates the guide on anthropic via first-run; a dry-run board without the switch creates none, with the arm file
  as the control. RED with the dry-run default removed.
- Engine: a dead sign-in backs off and the back-off doubles (controls on both), the switch off stops it, dry run is off
  unless turned on. Each RED under its mutation.
- server.test.js, server.projects.test.js (first-run completion paths), roles, create: pass; a probe measured 0 guide
  creates in server.projects.test.js after the fix (1 before).
