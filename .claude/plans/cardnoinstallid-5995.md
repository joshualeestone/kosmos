# cardnoinstallid-5995: an agent's card carried the install's id

Addresses #5995 (the fifth finding, comment 6132409431). Found while fixing item 3; its own branch on purpose.

## What was measured, on origin/main a8e120532
- A profile keeps a copy of the install's id (`idInstall`, written by `engine/store.js` beside the agent's own `id`).
- A card served the whole profile: `engine/status.js` set `profile:` from `store.readProfile` in two places, one for an
  agent with a pane and one for an agent without. A card goes to the page, and through Kosmos+ to a phone.
- Nothing reads it there. `idInstall` appears in no file under `web/`, in none of the Windows or native sources, and in
  no file of the relay, the community service or the site (each count taken with a control word that did match).
  Outside tests and plans the name is in `engine/store.js`, `engine/agentfile.js` (a comment), `tools/capture-agent-card.js`
  and the recorded card fixture.

## Change
- `engine/store.js`: `servedProfile(profile)` returns a copy without `idInstall`. The store owns the identity fields,
  so the name stays in the one file that writes it.
- `engine/status.js`: both card sites serve `store.servedProfile(...)`. The swarm read beside the pane site still takes
  the whole profile; it never leaves the engine.
- The recorded card (`docs/browser-checks/fixtures/agent-card.json`) loses the key, because a recording mirrors what a
  card serves; its test asserts the key is absent. The capture tool still blanks one, for a card captured from a board
  that predates this.
- `engine/status.cardnoinstallid-5995.test.js`, on the real snapshot: for each kind of card, the profile reached the
  card (control), the card's profile has no `idInstall`, the install's id is nowhere in the whole snapshot, and the
  stored profile still has its copy afterwards.

## Rejected
- Stripping `id` too. The agent's own id is a different question (the board already answers it through
  `store.agentId`, which refuses an id minted under another install, while the raw one rides in the profile). Noted on
  the card; not decided here.
- Deleting the key inside `engine/status.js`. That would put the name in a fifth source file, and the item 3 branch
  holds the set of files that name it.
- Not storing the copy at all. `store.agentId` and the copied-profile check both compare it.

## Verify
- `node --test engine/status.cardnoinstallid-5995.test.js`: 4 pass.
- Mutants, each applied and confirmed applied, then restored byte for byte: the pane site reverted -> the pane test
  red by name (and the no-pane test, whose whole-snapshot sweep sees the pane card); the no-pane site reverted -> the
  no-pane test red, the pane test green.
- `render-talk-goldencard-2519.test.js` 35 pass; `engine/status.test.js` 236 pass; `engine.reachable.test.js` 7,
  `install.reachable-1662.test.js` 46, `engine/store.test.js` 8, `engine/agentfile.test.js` 9,
  `engine/worldimport.test.js` 34, `engine/status.paneless-roster.test.js` 10, `server.agent-id.test.js` 2: all pass.
- NOT run yet: the full suite, and any browser check. The page does not read the field, so no page change is
  expected; that is reasoning from a search, not a look at the page.

## Weakest premise
That nobody reads `profile.idInstall` off a card. It rests on searches for the name. A reader that walks every key of
a profile (an export, a diff view) would not name it and would not be found; it would lose one key and nothing else.

## What would change this
A consumer that needs to tell, from a card alone, which install made an agent. Then serve a yes or no (as
`store.agentId` does), never the id.

## Order with the item 3 branch (installidwords-5995)
Both touch what is said about this field. Whichever merges second must, in `engine/installid-senders-5995.test.js`,
drop the recorded card fixture from the set of files that hold `idInstall` (it no longer does), and correct the two
sentences that say `engine/status.js` serves the profile's copy (`engine/ping.js` list, and that test's header).
