# allowpaused-6666: the board says why Allow cards are gone while Kosmos+ is paused (kosmos#6666)

Follow-up to kosmos#6656, whose tunnel half (kosmos-relay #509) withholds the pending list while Kosmos+ is paused for
maintenance and says so: `pending.json` carries `"paused": true`, and a refused `devices allow` answers
`{allowed: false, paused: true}` with exit 0.

**Current wording** (after review round 9; the rounds below show how it got here):
- The page line, `#plus-paused`: "Kosmos+ is paused for maintenance. No new phone, browser or computer can be let in
  until it is back, and one that was asking may need to ask again then."
- An Allow refused while paused (PAUSED_ALLOW_WORDS): "Kosmos+ is paused for maintenance, so no new device can be allowed
  right now. This request may need to ask again once Kosmos+ is back."

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
engine/remote.test.js, three tests: paused only when exactly true and fresh, with controls; a paused Allow refused in
words and not listed, with an ordinary-answer control; the vouch path waits out a pause. web.allow-card.test.js, one
test: the line, its place, the poll and the paint. docs/browser-checks/render-plus-paused-6666.js at 1400 and 390.

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
- A future mtime (the clock stepped back) more than 1 s ahead is not fresh. The tunnel's `elapsed()` refuses any
  future date; the board allows 1 s, because a file written this instant can read a fraction of a ms ahead of
  Date.now(). For that second the two can disagree. `ASK.paused` is
  declared with the other state. The Plus-off test asserts `paused === false`, so a missing field fails.

## Review round 4
- The paused line no longer ends "There is nothing to do": the tunnel can still list code-check rows while paused,
  each with buttons. It now ends "Nothing new can be allowed until then."
- Stated limit, not changed: `paused` holds only while the tunnel keeps rewriting pending.json. If it stops (the
  coordinator unreachable, the tunnel stopped), the line goes after 2 minutes and the section can go blank again.
  That is the staleness rule working: an old "paused" must not outlive what it describes.

## Review round 5
- The paused line promised that a request "waits until it is back, and shows here then". It may not: while paused
  the coordinator turns away sign-ins (503) and drops a pairing computer's row, which the tunnel then forgets after
  its grace window. The line now says only what holds: "Nothing new can connect or be allowed until it is back. A
  phone, browser or computer that was asking may need to ask again then."

## Review round 6
- The Allow refusal's second sentence ("This request waits: allow it once Kosmos+ is back, if it is still asking",
  from round 1, line 41 above) made the promise round 5 removed from the page. It now reads "This request may need to
  ask again once Kosmos+ is back."
- The page line says "Nothing can be allowed until it is back" (it said "Nothing new can connect or be allowed"): the
  tunnel refuses every Allow while paused. WRONG, corrected in round 7: a code check is confirmed before the paused
  refusal, so its row still works while paused.

## Review round 7
- Round 6 said the tunnel refuses every Allow while paused, code checks included. It does not: `allow_outcome`
  confirms a code re-check (`confirm_recheck`) before its paused refusal, and the snapshot still lists those rows
  (kosmos-relay crates/tunnel/src/devices.rs, measured on origin/main 0b93a6ab1). I wrote that sentence without
  reading the source. The line is now about new devices only, so it stays true beside a working code-check row, and
  the two comments that said the tunnel shows no requests now say no new requests.

## Review round 8
- Stated limit, not changed: a failed poll keeps the last paint (the rule every card on this page follows), so if
  the board itself cannot be reached while paused, the paused line stays until the next good poll. Clearing it on a
  failed poll would make the section go blank for a blip, which is the confusion this card removes.

## Review round 9
- The Allow refusal still said "nothing can be allowed right now", the claim round 7 removed from the page line,
  and the browser check's header still said the tunnel withholds every request. Both corrected, and this time the
  whole diff was swept for every copy of the claim (refusal words, its test, the check header, the vouch comment).
- The browser check's "both" control now also asserts "Waiting for you" returns over a listed row, and the off-Plus
  control keeps the pause on while a real request is listed, so it shows the pause does not hide that notice.

## Review round 10
- The browser check now presses Allow on a listed row while paused: the board's 400 carries the paused words and the
  card must say them, never "connected". Until now nothing exercised the click path the card is named for.
- Not changed, already decided in round 3: the refusal words last until the next poll withholds the row (about 5 s),
  then the paused line says why.
