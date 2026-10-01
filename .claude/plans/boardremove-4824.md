# boardremove-4824: the board's Remove tells the sign-in site (kosmos#4824)

Follow-up to kosmos#4803 (kosmos-relay PR #238). The relay side lets `kosmos-tunnel devices remove` end a device's
current sign-ins at the sign-in site and on the account's other computers, but only when given `--coordinator`.
The board's Remove passed none.

## What changes
- engine/remote.js `deviceRemove`: passes `--coordinator`. A connector from before kosmos#4803 refuses the flag
  before doing anything (clap prints `error: unexpected argument '--coordinator' found` and exits 2; measured on
  the pre-#4803 build at ~/work/kosmos-relay/dist/kosmos-tunnel), so on exactly that refusal it is asked again
  without the flag (exit 2 and that wording, both required). Any other refusal surfaces as before.
- web/index.html, the Devices list: after a Remove, `removedWords` says what it reached, from the answer: "Its
  sign-in also ends on your other computers" only when `signed_out` is true; otherwise (false, or absent from an
  older connector) "Kosmos+ was not told"; plus a line when `local_cutoff` is false. `paintDevices(keepMsg)` keeps
  that line through the repaint that follows (it used to be cleared, with the error line on a failed Remove too).
  The confirm keeps its old sentence, which is true whatever connector is installed.

## Decided (overridable)
- Runtime fallback, not a gate on the bundled connector's version: the removal here must keep working with
  whichever connector is installed, and a retry on clap's own refusal costs one extra spawn only on an old one.
- The other computers are claimed only after the fact, from the connector's own answer, not in the confirm: until
  a connector with kosmos#4803 is bundled, every board runs an older one.
- `signed_out: true` covers "the account has no such device" too (the relay reads its `no_such_device` 404 as
  nothing left to end), so the page then says the other computers are reached, which holds: none of them has a
  sign-in of it left to end.

## Weakest premise
That clap's wording for an unknown flag stays `unexpected argument '<flag>'`. If a clap upgrade rewords it, an
old connector's Remove would fail with clap's message instead of falling back. Only an old connector is affected,
and the test pins the measured wording.

## Checks
- engine/remote.test.js: remove passes `--coordinator` once and passes the answer through; an old connector (fake
  in `old-remove` mode, clap's measured words and exit 2) is asked again without it and still removes (control:
  any other refusal is not retried); `signed_out` / `local_cutoff` false reach the page.
- web.allow-card.test.js: `removedWords` run on each answer shape (told / false / absent / both false), and the
  keepMsg repaint wiring.
- docs/browser-checks/render-device-remove-4824.js: a real click on Remove for each answer; the line is still
  showing after the repaint; CONTROL: a plain repaint clears it.
