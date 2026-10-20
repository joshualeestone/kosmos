# boundtext-6708: a code bound to an address says so (done step and copied invitation)

Card: kosmos#6708, follow-up to kosmos#6681 slices 1 and 2 (#6688 merged; #6701 the field). Stacked on fedfield-6681.

## Why
Once a code is bound to one address, nothing on the invite sheet's done step or in the copied invitation said so: the
person invited learned it only from a refusal ("made for someone else") if they redeemed from another account.

## What changes
- Review 1: the sentence rests on the COORDINATOR's echo (`email` in its invite answer, kosmos-relay #502), passed
  through by `federation.invite` only when a string, never on the typed value: an older coordinator ignores `email` and
  mints an unbound code, and the sheet must not promise a restriction that does not exist. The typed-without-echo
  case is tested at the engine only (federation.test.js); B7's control types no address, so NO page arm pins "echo, not
  typed" yet (review 2; the next step). Review 2: the echo must also be shaped like an address (`^\S+@\S+$`).
- The copied text runs the address through the same line cleaner; an arm feeds it a newline and a bidi control.
- The done step's line adds "Only the Kosmos+ account with <address> can use it." for a bound code.
- `fedInviteText` (the copied invitation) ends with "It works only for the Kosmos+ account with the email address
  <address>." for a bound code, the address passed through the same line cleaner as the rest of the text.
- An unbound code's text is unchanged.

## Decided
- The address shown is the coordinator's echo (its normalised form, lowercased), since that is what it will check;
  review 1 replaced "as typed".
- The address goes into the invitation text the owner chooses to send; it names the recipient to the recipient.

## Tests
`docs/browser-checks/render-federation-invite-4649.js`: a bound code (A4's) names the address on the done step and in
the invitation; CONTROL: B7's unbound code mentions no address; A5's pinned sentence updated. Mutant: the done-step
line removed, red.

## Weakest premise
That showing the address in the copied text is wanted. It is the recipient's own address, sent by the owner to them;
if the owner pastes the invitation somewhere public, the address goes with it.
