# musenet-4569: Muse agents can reply to Kosmos (the sandbox no longer blocks 127.0.0.1)

Card: joshualeestone/kosmos#4569 (claimed:angel). This PR is the reply fix only; the Meta row colour, the sign-in
dialog states and the dropdown name are a second PR on the same card.

## Finished looks like
A Muse agent's shell commands can reach the board on 127.0.0.1, so `kosmos reply` from a Muse agent lands in the
person's DM instead of "Kosmos is not running". Measured done only when a real Muse agent's reply appears in Kosmos
(Josh's Mac, agent Mark), which this Mac cannot do (Muse is not installed here or on any Mac I can reach).

## Decision
- `turnArgs()` passes `--disable-sandbox` before the `--` separator.
- Rejected: `--sandbox-network enabled` (the card's recommendation). `muse exec --help` names the option but does
  not list its values (default proxy-only); `enabled` is a guess, and a value Muse refuses fails EVERY turn, not
  just replies. `--disable-sandbox` is named verbatim in the same help and takes no value. It also turns off
  Muse's filesystem sandbox; Kosmos already runs Codex agents with theirs off
  (--dangerously-bypass-approvals-and-sandbox), so this matches the other providers.
- Would change my mind: `muse exec --help` on a Mac with Muse showing `enabled` as a listed network value, which
  would let the filesystem sandbox stay on.

## Weakest premise
That `--disable-sandbox` exists in the Muse build on Josh's Mac. The help excerpt is from 1.4.1-R4503.1, the build
the root-cause doc quotes from his Mac; an older build without it would refuse the flag. Only the live test answers it.

## Tests
- engine/muserun.test.js: turnArgs includes `--disable-sandbox`, before `--`. Measured red with the flag removed.
