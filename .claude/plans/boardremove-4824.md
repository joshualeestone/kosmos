# boardremove-4824: the board's Remove tells the sign-in site (kosmos#4824)

Follow-up to kosmos#4803 (kosmos-relay PR #238). The relay side lets `kosmos-tunnel devices remove` end a device's
current sign-ins at the sign-in site and on the account's other computers, but only when given `--coordinator`.
The board's Remove passed none.

## What changes
- engine/remote.js `deviceRemove`: passes `--coordinator`. A connector from before kosmos#4803 refuses the flag
  before doing anything (clap prints `error: unexpected argument '--coordinator' found` and exits 2; measured on
  the pre-#4803 build at ~/work/kosmos-relay/dist/kosmos-tunnel), so on exactly that refusal it is asked again
  without the flag and the answer carries `old_connector: true`. Any other refusal surfaces as before.
- web/index.html, the Devices list: the Remove confirm says it stops "here and on your other computers". After a
  Remove, one line when the connector answered `signed_out: false` (Kosmos+ not reached: it may still open the
  other computers) or `local_cutoff: false` (its old sign-in could come back here if let in again).

## Decided (overridable)
- Runtime fallback, not a gate on the bundled connector's version: the removal here must keep working with
  whichever connector is installed, and a retry on clap's own refusal costs one extra spawn only on an old one.
- The confirm line states the new behaviour unconditionally. It is true once the bundled connector carries
  kosmos#4803; a board running with an older connector (a dev setup) over-promises the other computers.
- `signed_out: true` covers "the account has no such device" too (the relay reads its `no_such_device` 404 as
  nothing left to end), so the page says nothing extra then.

## Weakest premise
That clap's wording for an unknown flag stays `unexpected argument '<flag>'`. If a clap upgrade rewords it, an
old connector's Remove would fail with clap's message instead of falling back. Only an old connector is affected,
and the test pins the measured wording.

## Checks
- engine/remote.test.js: remove passes `--coordinator` once and passes the answer through; an old connector (fake
  in `old-remove` mode, clap's measured words and exit 2) is asked again without it and still removes (control:
  any other refusal is not retried); `signed_out` / `local_cutoff` false reach the page.
- web.allow-card.test.js: the confirm sentence and the two after-Remove lines.
