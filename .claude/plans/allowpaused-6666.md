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
  ok false without `listed`, so it is not taken back. Review round 2: it is also not counted as a try (as "still
  signing in" is not), so a pause that ends inside the secret's own 3-minute window still lets the browser in
  without the Allow card. Rejected: counting it (three paused refusals ended the secret in about 9 s, turning a
  one-step connect into a manual one for any pause). Review round 3 corrected the cost stated here: only a race
  reaches it, because the tunnel lists no rows while paused and the vouch path matches only listed rows. A row
  listed just before the pause began is retried each tick until the snapshot drops it (about 5 s), not for the
  whole window.

## Validation
engine/remote.test.js (+3, see review round 1; first two: paused only when exactly true, with controls; a paused Allow refused in words, not listed,
with an ordinary-answer control); web.allow-card.test.js (+1: the line, its place, the poll and the paint).

## Review round 1
- `paused` counts only from a pending.json written under 2 minutes ago (PAUSED_FRESH_MS, the same 120 s as the
  tunnel's own snapshot_says_paused; the tunnel rewrites the file every 5 s). A stopped tunnel, a slept Mac or an
  unreachable coordinator leaves the last file behind, and an old "paused" must not keep saying Kosmos+ is paused.
  Test: a 3-minute-old paused snapshot reads not paused, a 1-minute-old one reads paused. Mutant (gate removed): red.
- The vouch path under FAKE_TUNNEL_MODE=allow-paused: three paused refusals, nothing noted as on this computer, no
  `devices remove`, and the secret ends after the third try (the Allow card stays the way in). SUPERSEDED in round
  2: a paused refusal is no longer counted, so the secret stays live.
- Words: "allow it once Kosmos+ is back, if it is still asking". The paused line gets a muted style under
  `.plus-asks`. The self-grant log says "Kosmos+ is paused for maintenance" rather than quoting the person-facing
  sentence.

## Review round 2
- The snapshot's age is taken before it is read, so a rewrite in between can only make it look older (never a stale
  paused paired with a fresh mtime).
- A paused vouch refusal is not counted (see Decided). The test now asserts three paused refusals leave the secret
  live and the next ordinary answer lets the browser in. Mutant (counted again): red.
- `paused: false` on the Plus-off early return, so the field is always present.

## Review round 3
- A browser check, docs/browser-checks/render-plus-paused-6666.js (1400 and 390 wide): paused with nothing listed
  opens the section on the paused line alone, with no "Waiting for you"; CONTROLS: not paused shows no section, and
  paused with a request still listed shows both; on another view a pause alone brings no top card, and a real
  request still does.
- The paused line names a computer too ("A phone, browser or computer asking to connect"): the tunnel withholds a
  joining computer's row while paused as well.
- Expected, not a defect: an Allow pressed just before the snapshot says paused shows the refusal words on its card;
  on the next poll (about 5 s) the row is withheld, the card goes, and the paused line shows instead.
- A future mtime (the clock stepped back) is not fresh, matching the tunnel's `elapsed()` refusal. `ASK.paused` is
  declared with the other state. The Plus-off test asserts `paused === false`, so a missing field fails.

## Review round 4
- The paused line no longer ends "There is nothing to do": the tunnel can still list code-check rows while paused,
  each with buttons. It now ends "Nothing new can be allowed until then."
- Stated limit, not changed: `paused` holds only while the tunnel keeps rewriting pending.json. If it stops (the
  coordinator unreachable, the tunnel stopped), the line goes after 2 minutes and the section can go blank again.
  That is the staleness rule working: an old "paused" must not outlive what it describes.
