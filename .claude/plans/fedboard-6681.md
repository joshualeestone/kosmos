# fedboard-6681: the board understands the S-11-fed refusals, and can send a bound address (slice 1 of kosmos#6681)

Card: kosmos#6681, the board half of kosmos#6639 (kosmos-relay branch fedbind-6639: a federation invite may be bound to
one address; three new refusal codes).

## Why
`engine/federation.js` maps a coordinator refusal to a page reason by matching its SENTENCE (`REASONS`). The three new
refusals match none, so the page got a 502 with no reason: the "service trouble" shape, for what is a definite answer.

## What changes (slice 1)
- `federation.codeRefusal`: the refusal's CODE (the tunnel prints it; `remote.refusalOf`, kosmos#5744) maps to a fixed
  reason before any sentence is tried: `federation_wrong_invitee` 409 `wrong-invitee` (verify),
  `federation_invite_email` 400 `bad-email` and `federation_invites_full` 409 `invites-full` (invite). An unknown code
  falls through to the sentence map as before.
- `federation.invite` passes an optional `email`, trimmed; empty sends none; a non-string or one over 254 characters is
  refused (400 `bad-email`) before anything is signed. `fedmembers.invite` already carries the body through.
- The page (`pjFedMessage`) words each reason. `wrong-invitee` names nobody (the reader is the one it was not for).

## Not in this slice
- The address field on the invite sheet (slice 2, with design shots): until then the board sends no `email`, so every
  code stays unbound, exactly as today.
- 409 is used for `wrong-invitee` (as verify's other reasons), not the coordinator's 403: the invite sheet reads a 403
  as "not from this screen".

## Tests
`engine/federation.test.js` (two `kosmos#6681` tests: the address trimmed, empty sends none, bad types and length refused
unsigned; each code maps whatever the sentence; an unknown code falls back) and `web.federation-3312.test.js` (each
reason worded; wrong-invitee carries no address). Mutants: verify ignoring codes, invite ignoring codes, the address not
forwarded, each red.

## Weakest premise
That the tunnel in use prints the refusal code. An older tunnel prints none (`refusal` null), and then these three fall
back to the sentence map, which does not know them: a 502 again, as before this change, never worse.
