# statusword-7004: the Mac sends each agent's status word and tone ready-made (iPhone slice 2)

Card: kosmos#7004, slice 2 of the native iPhone plan (#6838, plan comment 2026-10-21 14:25). Splinter 2026-10-23
17:56: #6846 and #6838 wait on a device, so take the next piece that a simulator can check.

## Finished looks like
`/api/status` rows carry `cardWord` (the computer's own word, engine/cardlabel labelOf) and `cardTone` (asked,
needs_you, working or quiet, Mona Lisa's slice 1 table); the iPhone app shows them, and falls back to its own table
for an older Mac. The fallback words and needs-you set are kept equal to the engine's by a test (the phone's ordering rules are not compared). The app builds and shows the list on
the simulator. The real-iPhone check waits with #6838's device list.

## Why (measured)
The phone kept a third copy of the words with nothing comparing it, and it had drifted: the computer has said
"Sign-in Issue" since #6716 (2026-10-20), the phone "Sign-in isn't working". The phone could also never say a
restart's cause ("Switching to Opus"), only "Restarting agent".

## Change
- engine/cardlabel.js: `toneOf(card, needsPerson)` and `NEEDS_YOU_WORDS`, built from STATE_COPY's own values.
- server.js: `withCardWords`, run last over the finished /api/status rows (the word reads fields the route attaches
  late: reconnect, crashLoop, disruption).
- ios/Kosmos/BoardLogic.swift: `macWord` / `macTone` parsed from `cardWord` / `cardTone`; `statusWord` and `tone` use
  them first; `tone(named:)` maps a name and gives nil for one it does not know; the fallback table's auth_failed
  word corrected.
- ios/Kosmos/BoardClient.swift, ContentView.swift (Debug only): the sample agents go through the real parser as
  rows with cardWord and cardTone, and open on Agents, so the simulator shows this path.
- Tests: server.statusword-7004.test.js (toneOf cases; the route on a fake fleet, every row equal to labelOf and
  toneOf over itself; the phone's fallback words and needs-you set equal to the engine's); ios/LogicTests section
  "the Mac's own word and tone".

## Decided
- Field names `cardWord` / `cardTone`, not `label` / `tone`: new names cannot collide with an existing reader.
- The count of agents needing the person is not added: `counts.needsYou` already carries it (countAgents, with the
  route's offline rows added). Slice 4's Today badge reads that.
- The tone rule lives with the words on the Mac (one place, for Android too); the phone keeps its rule only as the
  fallback.
- A tone name the phone does not know is nil and the phone's own rule decides, so a tone the Mac adds later never
  shows as something it is not.

## Weakest premise
That a needs-you tone set chosen for the phone belongs in the engine. It is Mona Lisa's design for the phone's list,
not the board's own colouring; if the board's page ever wants a different set, the two would need separate names.

## Validation
- server.statusword-7004.test.js 4/4; ios/LogicTests 519/519; every test reading cardlabel, BoardLogic, the
  status route's row helpers or /api/status, with the standing guards: 1089 tests, 0 failed.
- Simulator (iPhone 18 Pro, iOS 27): Debug build, sample agents, light and dark: Sign-in Issue in red, Switching to
  Opus in grey, Question in gold first. Shots: ~/work/design-shots/kosmos-7004/.
- Release simulator build: the sample switch is absent (0 matches), the Debug build carries it (1, the control).
