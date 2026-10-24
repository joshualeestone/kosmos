# tiletext-6716: no sentences on agent tiles; "Sign-in Issue"; a model for a session with no reply yet (kosmos#6716)

**Card.** Josh, #admin 2026-10-20 08:38, with two tiles from tmnt's board: "i dont want to show these messages on these
agent tiles. I am not sure why it doesnt recognize Renet's model. instead of the large pause button with \"sign-in
isn't working\" lets shorten it to \"Sign-in Issue\"". Mikey's tile carried a paragraph about unsent text; Renet's carried
the pill "Sign-in isn't working", "Made before Kosmos recorded this" where the model goes, and "Looks like its Claude
sign-in isn't working".

## Calls
1. **No sentence on a tile or a list row.** `stateReason(a, { card: true })` returns '' (the rule lives there, so every
   caller with `card` gets it; taskLine delegates). The not-running tile's note (rules behind, idle days), the list
   row's rules-behind note and the workspace-trust tile's note go too. Each sentence moves to the pill: its `title`
   (hover) and a visually hidden span (screen readers; a title is not read reliably and the list pill is aria-hidden),
   through `pillSay`/`pillVh`/`pillTitle`, which generalise #6398's rate-limit-only helpers to every state. The agent's
   own page still shows every sentence in full (it calls without `card`). The list row is included because it is built
   from the same derivations so the two cannot disagree (#855's rule), and Josh's "these messages" are the same ones.
   Rejected: keeping some sentences (crash loop, needs-trust) on the tile: he asked for none; the pill still marks them.
2. **"Sign-in Issue"** on the page (STATE_COPY.auth_failed) and in engine/cardlabel.js (kept equal by cardlabel-5959).
   It is no bigger than the other pills (measured: every pill 30px tall; the old label was long, which is what made it
   big).
3. **Renet's model.** Measured on this machine: her account move at 08:34 started a new session (transcript created
   08:37:43); her sign-in was failing, so it never got a reply and held no model line; readModel reads only the newest
   transcript, so the reading was empty, and with no Kosmos login job (the fleet launcher starts her) the tile fell back
   to "Made before Kosmos recorded this". Now, when the newest session has no model, readModel takes the newest earlier
   session in the agent's own folder (same cwd check as transcriptFor's workdir arm, five at most), flagged
   `earlierSession: true`. The snapshot keeps that out of `model` (splitModelReading: context sizing, the model panel's
   "Right now", a switch's label and the server's checks all read `model`) and carries it as `earlierModelName`, which
   only `tileModelLine` (the tile and the list row) uses, and only where it would otherwise say "Made before Kosmos
   recorded this" or "Unknown Model"; modelLine, the picker and Runs on never show it (review 5). Only sessions older
   than the current one lend (review 5). whoami skips a borrowed model (the launch reading answers). Cached a minute
   per agent and file.

**Done when.** No tile or list row draws a sentence; the pill's hover and screen-reader text carry it; the auth pill reads
"Sign-in Issue" at normal size; a session with no reply yet shows the model its earlier session ran.

## Tests
- All web.*.test.js and cardlabel tests: 3100 pass. Updated to the new rule: web.not-running (offline tile/row on the
  pill), web.trust-wait-card-3013 (trust note on the pill), web.rulesbehind-5957 and -render-5957 (pillSay), 
  web.muse-waiting-4569 (card ''), web.quoted-line-986 and web.stateread-5949 (markup shape).
- engine/status.earlier-model-6716.test.js (9): splitModelReading keeps a borrowed model out of `model`; only an
  EARLIER session lends; earlier session lends its model, flagged; CONTROL a replied session reads
  itself; nothing invented with no earlier model; another folder's session never lends. Mutation: without the fallback
  the first arm reds.
- Browser: render-unsent-input-6249 (20: the pill hover carries it, a screen reader hears it, no sentence on the tile),
  render-stale-auth-1930 (11, "Sign-in Issue"), render-mobilenav-4823 (173). Tiles rendered in four states, light and
  dark: every pill 30px, every task line empty.

**Weakest premise.** That an agent's earlier sessions sit in the same folder as its new one. On this fleet the account
folders share one transcript tree, so they do. On a machine where each account keeps its own, an account move leaves
no earlier session beside the new one, and the tile falls back as before (no worse than today).

**Broad run (review 3).** `node --test *.test.js engine/*.test.js`: 22532 tests, 16 failed. One was this change (the
#2519 snapshot fixture lacked `earlierModelName`; re-captured with tools/capture-agent-card.js, 35/35). The other 15
(cli.limitmsg-5805, cli.msgqueue-5187, cli.task-webhook-1307, cli.unknown-flag-4889, server.subtasks-3861) fail the
same way on a branch without this change ("we could not match that to one of your agents"), when run from inside an
agent session; not this change.

**Decided (review 8).** The pill reads stateReason's page path. Before this change the card path differed from the page
path in exactly two arms: the rate-limit sentence (already the pill's since #6398) and the rules-behind note (now in
pillSay). So the pill carries the same set of sentences the tile used to, plus none.

**Review 7.** Only a session from within two days before the current one lends (an old account or runner never reads as
today's), and an unreadable sibling never lends. Each pill's sentence is computed once per tile and row.

**Review 6.** A session whose time cannot be read lends nothing (fails closed). The tile keeps its empty .atask slot so
tiles stay one height. whoami test cards come from test-support/fleet (fixture-discipline).

**Decided (review 4).** Start at login's repair (`/api/register` modelFor) takes a borrowed model on purpose: it restores
what the agent last ran as and acts only on agents with no login job, so no planned model competes. The re-captured card
fixture also changed `lastWorked` (null to a pinned date): the capture tool records a live card from this machine, and
only keys and types are pinned (render-talk-goldencard-2519 35/35).
- server.whoami-earlier-6716.test.js: whoami does not report a borrowed model (CONTROL: a replied session is used).
- web.tile-model-6716.test.js: the tile names the earlier model only as a last resort; modelLine never does.
