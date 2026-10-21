# allowpaused-6666: the board says why Allow cards are gone while Kosmos+ is paused (kosmos#6666)

Follow-up to kosmos#6656, whose tunnel half (kosmos-relay #509) withholds the pending list while Kosmos+ is paused for
maintenance and says so: `pending.json` carries `"paused": true`, and a refused `devices allow` answers
`{allowed: false, paused: true}` with exit 0.

## What changes
- engine/remote.js `pendingDevices`: passes `paused`, true only when the snapshot says exactly `true` (a string, a
  number, a missing field or no snapshot is not paused; a board with Plus off never says paused).
- engine/remote.js `deviceAllow`: an answer with `paused: true` is a refusal with PAUSED_ALLOW_WORDS, marked
  `paused: true`, never `listed` (the tunnel writes nothing to this computer's list while paused, kosmos#6656).
- web/index.html: a hidden line `#plus-paused` inside the requests section; the poll sets `ASK.paused` from
  `r.paused === true`, and painting shows the line and keeps the section open while paused.

## Decided
- The line is in the Kosmos+ section only, not the compact top card on other views: nothing waits for the person,
  so nothing should pull them to Kosmos+ while it is paused. Rejected: a top-of-window notice (it would read as
  something to act on). Weakest premise: that the person looks at the Kosmos+ section when they wonder why a phone's
  request has not shown; the phone side is told separately by Kosmos+ itself.
- The vouch path (an automatic Allow for a browser this computer itself signed in): a paused refusal returns
  ok false without `listed`, so it is retried on the path's own budget, not taken back.

## Validation
engine/remote.test.js (+2: paused only when exactly true, with controls; a paused Allow refused in words, not listed,
with an ordinary-answer control); web.allow-card.test.js (+1: the line, its place, the poll and the paint).
