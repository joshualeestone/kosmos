# pushdefault-6488: phone notifications on by default (kosmos#6488)

Josh, 2026-10-18 09:43 CDT: "Let's have notifications switched on by default". Done means it is on for new computers
and for existing ones whose owner never touched it, an explicit off stays off, and a phone that registers starts
receiving with no extra step.

## The change

- `engine/phonenotify.js`
  - `masterChoice()` says on, off, or unset (never touched).
  - Off is any of:
    - the `off: 'person'` marker, which Turn off writes and a sub-switch change keeps;
    - a token or notifyId held with the switch off (only a turn-on saves either);
    - `phone-notify-choice.json`, kept beside remote.json so it survives removing the computer;
    - a settings file that cannot be read.
  - `ensureDefaultOn()` turns an unset computer on through the same `turnOn` as the Settings button. It needs Kosmos+
    live here: signed in AND switched on (`plusLive`).
  - `startDefaultOn()` runs that at startup and on a schedule:
    - 5 minutes;
    - doubling to 15 minutes on failure;
    - 1 hour after a mint it could not use;
    - not lengthened by a refusal made here before anything was sent;
    - reset by a connection change.
  - `pokeDefaultOn()` runs it at once after each way of connecting.
  - Nothing goes to Kosmos+ while its switch is off here: no event (`happened`), no mint (`doTurnOn`), no default.
- `server.js`
  - Starts the schedule in the listen callback; not under the test runner.
  - `phoneDefaultAfterConnect()` runs after a register, the sign-up, the company sign-in and switching Kosmos+ on.
- `web/index.html`
  - Settings says the state truthfully (`offByChoice`, `defaultBecause`).
  - It looks again by itself: every 30 s while connected, 2 min otherwise, and on visibilitychange.

## Decided, and not built

- No "keep it off" before the default turns it on. That is a new board control, and Josh ruled on by default; the
  person turns it off after, and that off is kept for good.
- No "needs an update" state. `tools/lib/connector-verbs.sh` refuses a bundle whose tunnel lacks `mac-request`
  while this is open.

## Known gap

An off made on an older version, on a computer also removed from Kosmos+ on that older version, left no record. After
upgrading and reconnecting it turns on.

## Rollback

Revert the branch. The kept-off file is ignored by the old code, and the old default (off) returns.
