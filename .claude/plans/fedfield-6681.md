# fedfield-6681: the invite sheet can bind a code to an email address (kosmos#6681 slice 2)

Stacked on fedboard-6681 (slice 1, kosmos #6688: the engine sends `email` and maps the three refusals by code).

## What changes
- `web/index.html`, the invite sheet's ask step: an optional "Their email address (optional)" field, `type=email`,
  `maxlength=254`, `autocapitalize=off`, `spellcheck=false`, `autocomplete=off`, with its hint tied in by
  `aria-describedby`. Empty on every open; an empty field sends no `email` at all.
- An address the browser already sees is not one (`validity.typeMismatch`) is answered at once, on the field, with no
  request; the coordinator stays the judge of everything else. Its `bad-email` refusal lands on the address field
  (focused, `aria-invalid`), not on "Who is it for?" (review 1).
- `docs/browser-checks/mobile-shots.js`: a `fed-invite` screen, so this sheet can be shot for design review.

## Decided
- Design review (Mona Lisa, 05:28): approved, with the shorter hint "Then only the Kosmos+ account with this address can
  use the code." Declined, with the reason in the markup: `autocomplete="email"`, which would fill in the person's OWN
  address, the one value this field must never hold.
- Kept for "Their agent": the coordinator checks the email of the Kosmos+ account that redeems, which for an agent is
  its person's account, so the label still reads right.

## Not covered
- 36 px field height on phones, as the sibling "Who is it for?" field (design review: both to 44 px together, a
  separate card).
- `maxlength` counts UTF-16 units, the board's bound counts bytes: an internationalised address can pass the field and
  be refused as "does not look right".
- `autocomplete=off` is a hint some browsers ignore for email fields.

## Tests
`docs/browser-checks/render-federation-invite-4649.js`: the field (empty, optional, type email, autocapitalize and
autocomplete off) and empty sends no email; a typed address is sent trimmed; a refused address marks the address field,
focused; a non-address is answered with no request; reopened, the sheet forgets an earlier address and sends none.
Mutants: the send removed, the reset removed, the refusal routing removed, each red.
