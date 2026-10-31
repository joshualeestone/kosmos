# backupscreens-7404: the personal backup screens (kosmos#7404)

Decided end to end on the card (comment 6543796792): the recovery code is made on this computer and shown once;
Kosmos+ cannot read it. Price is Josh's: read from config, a placeholder until he sets it.

## Status
- [x] 1. Plan (this file)
- [x] 2. Sketch + /design-shots, design review BEFORE building past the sketch
- [x] 3. Board-side switch and price reader (engine/personalbackupoffer.js)
- [x] 4. Server routes
- [x] 5. Settings panel, full (reviewed: Mona Lisa, #7404 comments 6543885328, 6543996951, 6544056036)
- [x] 6. Tests (engine, routes), the five full-suite-only guards, browser checks
- [ ] 7. challenge-loop, PR

## Board-side switch and price
- `engine/personalbackupoffer.js`: `offer()` -> `{ shown, price }`.
  - `shown`: `KOSMOS_PERSONAL_BACKUP=1` in the board's environment (the same name as the coordinator's switch, so one
    word turns both on). Off by default: nobody sees the panel until it is on.
  - `price`: `KOSMOS_PERSONAL_BACKUP_PRICE` when it passes remote.js PRICE_SHAPE (`$5/month`), said as the page
    already says Stripe prices (plusSiAddPrice). Anything else, or unset: `null`, and the panel says
    "Price to be set" instead of a figure. Never a made-up number.
- Weakest premise: an environment variable is a staff switch, not a product setting. Fine while the price is
  undecided and the coordinator switch is off; when Josh sets a price it should come from the coordinator's answer
  (as address prices come from Stripe), and this reader is what gets replaced.

## Routes (server.js, next to /api/org)
All person-only: `isViaScreen` refused with 403, as /api/org/*. Each answers only named fields.
- `GET  /api/personal-backup`: `{ shown, price, state }` (state from personalbackup.state()). Not shown: `{ shown: false }` only.
- `POST /api/personal-backup/preview`: preview() -> `{ ok, ticket, words }`.
- `POST /api/personal-backup/on` `{ ticket, accepted }`: switchOn() -> `{ ok, code, org, member }` once; the code goes
  to the screen in this one answer and nowhere else (never logged).
- `POST /api/personal-backup/key`: setUpKey() for state needs-key (shows the same code again while unconfirmed).
- `POST /api/personal-backup/saved` `{ org, member }`: confirmRecoveryCodeSaved().
- `POST /api/personal-backup/restore` `{ code }`: restorePersonalKey().
- `POST /api/personal-backup/off`: switchOff().
- Step-up from a remote session: on, key, restore, off (each moves a key or ends a membership). preview and saved are not
  gated (one reads, the other deletes a local copy of a secret).
- Every route answers 404 when not shown, so a board with the switch off has no surface.

## Panel (Settings, Kosmos+ section, under the company block)
States: off -> words -> code shown -> on; needs-key; pending; restore.
- Off: one line of what it is, the price (or "Price to be set"), Turn on.
- Words: the coordinator's words (reports/backsUp/readers/never) as the company join shows them; Accept / Not now.
- Code: the recovery code, large, monospace, grouped; "Kosmos+ cannot read this code and cannot recover it. Without it,
  a new computer cannot open this backup." Copy, Print, then "I saved it" (confirm). No way back to the code once
  confirmed.
- On: "Personal backup is on for this computer." Turn off (armed, as Leave is).
- Restore: a code field, Restore.
- Must NOT say: that "personal" means not gathered into a company rollup on a work computer.

## Not in this branch
The backup job itself, the price from the coordinator, any change to the relay.
