# boundtext-6708: a code bound to an address says so (done step and copied invitation)

Card: kosmos#6708, follow-up to kosmos#6681 slices 1 and 2 (#6688 merged; #6701 the field). Stacked on fedfield-6681.

## Why
Once a code is bound to one address, nothing on the invite sheet's done step or in the copied invitation said so: the
person invited learned it only from a refusal ("made for someone else") if they redeemed from another account.

## What changes
- `fedInviteMake` keeps the address typed (`FEDINV_MADE.email`; the engine's answer does not echo it).
- The done step's line adds "Only the Kosmos+ account with <address> can use it." for a bound code.
- `fedInviteText` (the copied invitation) ends with "It works only for the Kosmos+ account with the email address
  <address>." for a bound code, the address passed through the same line cleaner as the rest of the text.
- An unbound code's text is unchanged.

## Decided
- The address shown is the one the owner typed (trimmed), not the coordinator's normalised form: the owner recognises
  their own typing, and the coordinator compares ignoring case.
- The address goes into the invitation text the owner chooses to send; it names the recipient to the recipient.

## Tests
`docs/browser-checks/render-federation-invite-4649.js`: a bound code (A4's) names the address on the done step and in
the invitation; CONTROL: B7's unbound code mentions no address; A5's pinned sentence updated. Mutant: the done-step
line removed, red.

## Weakest premise
That showing the address in the copied text is wanted. It is the recipient's own address, sent by the owner to them;
if the owner pastes the invitation somewhere public, the address goes with it.
