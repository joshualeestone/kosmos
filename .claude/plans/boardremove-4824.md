# boardremove-4824: the board's Remove tells the sign-in site (kosmos#4824)

Follow-up to kosmos#4803 (kosmos-relay PR #238). The relay side lets `kosmos-tunnel devices remove` end a device's
current sign-ins at the sign-in site and on the account's other computers, but only when given `--coordinator`.
The board's Remove passed none.

## What changes
- engine/remote.js `deviceRemove`: passes `--coordinator`. A connector from before kosmos#4803 refuses the flag
  before doing anything (clap prints `error: unexpected argument '--coordinator' found` and exits 2; measured on
  the pre-#4803 build at ~/work/kosmos-relay/dist/kosmos-tunnel), so on exactly that refusal it is asked again
  without the flag (exit 2 and that wording, both required; ANSI colour stripped first). Any other refusal surfaces
  as before. A connector killed on the retire timeout (either call) answers `timed_out` rather than a failed Remove;
  the page says it took too long and, if the device is still on the list, to remove it again; if it is gone, that
  it may still open the other computers (the kill can land after the list write and before the tell). The page's
  POST has no timeout of its own: the board answers within the retire timeout, and `finally` clears Removing.
- web/index.html, the Devices list: after a Remove, `removedWords` says what it reached, from the answer: "Its
  current sign-in on your other computers ends too; it stays allowed there until you remove it there" only when
  `signed_out` is true; "Kosmos+ could not confirm its sign-in was
  ended, so it may still open your other computers" when it is false (or a new connector left it out); "It was not on this
  computer's list" when `removed` is false; a line when `local_cutoff` is not true. A connector from before
  kosmos#4803 answers neither field, and gets one plain sentence saying how it works (if let in on the other
  computers too, it still opens them until removed there, and an old sign-in comes back if let in again here),
  not a failure. Telling Kosmos+ makes a Remove slow (the connector's own tell gives up at 10 s; the board waits up
  to its retire timeout per connector call), so the row says Removing, its button is
  disabled, and no second Remove can start while one is out (`ASK.removing`).
  The line lives in `ASK.said` and is repainted by every `paintDevices` (the 5 s `paintPlus` poll included,
  without rewriting an unchanged assertive alert) until the next Remove or Keep click, or two minutes; it used to
  be cleared by the very next repaint, as was the error line of a failed Remove. A list that cannot be read while
  that line is up adds "The list above could not be read just now." after it rather than replacing it. No timing is promised for the
  other computers: each ends it on its next poll. The confirm keeps its old sentence, which is true whatever
  connector is installed.

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
- server.test.js: the Remove route hands the page every answer field unchanged (engine stubbed; control: a refusal
  is still a 400 with the engine's sentence).
- web.allow-card.test.js: `removedWords` run on each answer shape (told / false / absent / not on the list / both
  false), and the `ASK.said` wiring.
- docs/browser-checks/render-device-remove-4824.js: a real click on Remove for each answer; the line is still
  showing after one of the page's own 5 s polls (two list reads that started after the Remove answer, finished);
  CONTROL: the next Remove click clears it; CONTROL: with what the Remove said forgotten, the same wait finds the
  line empty (the measurement can see a clearing repaint); busy arm: Removing, disabled, one POST.
  Listed in docs/browser-checks/gated.txt and declares `removedWords paintDevices`, so a page change to either
  selects it (tools/bc-pr-select.js).
