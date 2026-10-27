# signinstall-7212 (kosmos#7212 slice 3): a stall caused by a lapsed Claude sign-in names that cause

Spec: #7212 comment 6449590482. An outside person's agent was silent for five days because Anthropic signed the Claude
account out; slice 2 would have said "Messages stuck" with a generic reason.

## Built
- engine/accounts.js: `checkRowLive(row)`, the one-row live check listLiveNow already ran, factored out (same code, so
  the accounts screen and the stall can never disagree about "signed out").
- engine/stallsignin.js: `overlay(card)`. A card with a deliveryStall, a Claude runner (empty or claude) and a Claude
  account (no `provider`: vendor and Qwen folders are not Claude accounts) is checked live in the background, at most
  once per stall and once per CHECK_EVERY_MS (an hour); a check never runs twice at once. Only STATE.NONE marks it
  signed out; CONNECTED clears it; unknown or no row leaves what the last check learned. The tick only reads.
- engine/deliverystreak.js: the words, beside slice 2's: "Its Claude account is signed out" / "Sign in again in
  Settings, AI Models". The card keeps the stall (since, count, lastWhy) and gains `signedOut: true`.
- server.js: the status route overlays its cards; the minute sweep forgets agents no longer stuck.

## Decided
- Claude only. Non-Claude runners already get a sign-in hold (signinHeldVerdict), which Homer owns (#7369); untouched.
- The board log's stall line keeps slice 2's words (it reads the streak, not the card). Stated, not changed.
- The route test is a source check: the board runs in a process a stall cannot be planted in from a test.

## Weakest premise
That the card's account summary finds its accounts.list() row by folder (or isDefault). If it finds none, nothing is
checked and the card says what slice 2 says, which is the safe direction.

## Review round 1 (opus): 0 blocker, 2 major, 4 minor, 3 nit
- MAJOR fixed: the test seam replaced the whole check, so which row a card matched was untested. The seam is now the
  account list and the live call (setDepsForTests); tests match the default row, a second account's row, a key's row,
  and a card with no row is never checked. Mutant (first row for every card) red.
- MAJOR fixed: after the person signs in again, the card said "Sign in again" until the next hourly check.
  accounts.checkRowLive tells stallsignin.heard a row is connected (the accounts screen opening is enough), which
  clears every stuck agent on that account at once. Mutant (heard does nothing) red.
- MINOR fixed: a throw before the check (an unreadable account list) left the record running forever; it is now a
  rejected promise, so the stall is checked again an hour on.
- MINOR fixed: the minute sweep keeps a record whose check is running or started within the hour, so a card leaving
  its stall for a minute does not start a second check.
- MINOR fixed: an api-key account's refused key says "Its Claude key no longer works. Replace its key in Settings,
  AI Models", not "sign in".
- MINOR NOT done, stated: a sign-out that removed the folder's sign-in identity leaves no accounts.list() row, so
  nothing is checked and the card keeps slice 2's words. Whether Anthropic's revocation removes that identity on the
  person's machine is unverified; checking a folder with no row would need a second definition of "a Claude folder".
- NITs fixed: comments say the hour runs from when a check started; listLiveNow's "ONLY" names the second caller;
  checkRowLive's requires sit inside its try.
