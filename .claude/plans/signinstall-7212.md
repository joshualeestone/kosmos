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

## Review round 2 (sonnet): 0 blocker, 1 major, 3 minor, 2 nit
- MAJOR fixed: the record was per agent, so N stuck agents on one signed-out account started N `claude auth status`
  checks an hour. It is now the ACCOUNT's ('default' or its folder): one check an hour per account serves every stuck
  agent on it. Decided: a new stall within that hour reads the account's answer rather than checking again ("at most
  once per stall" became "at most once per account and hour", which is cheaper and the same answer).
- MINOR fixed: subscription.checkLive (every caller: the accounts screen, sign-in and reconnect flows, the agent's
  account route) tells stallsignin.heard what it saw, not only accounts.checkRowLive.
- MINOR fixed: a "signed out" from a check that started before a connected answer was heard is ignored.
- MINOR fixed (by the per-account record): an agent moved to another account reads that account's record.
- NIT fixed: the answer handler cannot throw out of the chain.
- Mutants red: the stale-answer guard removed. The sweep forgets accounts no stuck card read for an hour, never one
  whose check is running.

## Review round 3 (opus): 0 blocker, 1 major, 3 minor, 2 nit
- MAJOR fixed: `claude auth status` is expiry-blind (#874): it says logged in while Anthropic refuses every request,
  which is the very case of the report. "Signed out" is now decided as the AI Models badge decides it
  (observed.verdict): the live check plus the freshest real request Kosmos saw for the agent or a Check now on its
  folder. A fresh 401 is signed out whatever auth status says; a fresh good request is not. No extra live call (the
  observations are in memory). Mutant (live check alone) red.
- MINOR fixed: a stored key's "refused" is cleared only by accounts.checkRowLive (which tries the key), never by
  `claude auth status` on that folder.
- MINOR fixed: the subscription.checkLive and checkRowLive hand-offs are tested by behaviour (a stubbed runner; each
  clears only the account it checked, the default included), not by reading source.
- Found by that test: a "none" and a "connected" in the same millisecond is a tie, and a tie never claims signed out.
- MINOR/NIT fixed: comments say "per account and hour"; the unused signedOut export is gone.
- NIT stated: a default agent launched with CLAUDE_CONFIG_DIR=<HOME>/.claude would be checked as the bare default;
  Kosmos does not launch the default account that way.
- Weakest premise now: that the 401s observed.js records reach it for a stuck agent (they come from its own requests
  or a Check now). With neither, the live check alone decides, and it can say logged in for a revoked account.

## Review round 4 (sonnet): 0 blocker, 1 major, 2 minor, 1 nit
- MAJOR fixed: a fresh 401 outranked a sign-in heard after it, so the card said "Sign in again" for up to five minutes
  after the person did. A request seen at or before the last connected answer no longer counts; a newer 401 does.
  Mutant red.
- MINOR fixed: the two tests whose code stamps real time run on a real-time base.
- MINOR stated: several accounts starting a check on the same tick each read accounts.list() (a readdir and a small
  file read per folder), once an hour per account; not worth a second cache.
- NIT stated in the header: heard is stamped on arrival, so a slow connected check can hide a newer "none" until the
  next hour (the safe direction).

## Review round 5 (opus): 2 major, 2 minor. The root of both majors: a second copy of the badge's logic, drifted
- MAJOR fixed: the card read only the stuck agent's own requests, while the AI Models badge reads the freshest request
  of ANY agent on the account and a Check now on its folder. So the card missed a sibling's 401 (a revocation shows on
  the agent whose turn hit it, not on the one that is stuck: a stall cannot coexist with its own fresh 401, since an
  auth_failed card resets the streak) and contradicted a sibling's good request. The badge's join is now ONE function,
  server.js claudeObservationsFor, used by the accounts route and handed to the overlay as obsFor (built only on a
  tick where some card is stuck: it reads job files). Mutant (ignore obsFor) red.
- MAJOR fixed: round 4's rule (a request older than the last connected answer does not count) let an expiry-blind
  "connected" from auth status erase a real 401, including a Check now's, so the card and the badge disagreed again.
  Removed: as on the badge, a fresh request outcome outranks the live check either way. Decided, and this reverses
  round 4: after the person signs in, the card says "signed out" until the 401 is five minutes old or a good request
  is seen, exactly as long as the badge says "rejected". Agreeing with the badge beats clearing sooner than it.
- MINOR fixed: the live state is the latest answer (an unknown one is unknown), as the badge reads it.
- MINOR fixed: a connected answer for the default account named by its folder clears the default account's record.

## Review round 6 (sonnet): 0 blocker, 1 major, 3 minor, 1 nit. The extraction checked line by line: badge unchanged
- MAJOR fixed: another caller's live check was heard only when it said connected, so a "none" the AI Models screen
  just showed never reached the stuck card. heard now records every answer (none, connected, unknown as unknown), and
  any check that started at or before it is older when it lands (one rule, both directions). Mutant red.
- MINOR fixed: the join is built on the first card that asks (a stuck Claude card with an account record) and once
  per tick, never for a stuck Codex card alone.
- MINOR fixed: claudeObservationsFor is exported and tested on real job files and observations
  (server.stallsignin-7212.test.js): a sibling's 401 is its account's evidence and not another account's; a newer
  Check now decides and is the same object (observedFrom); a card fed the join says what the badge says.
- MINOR fixed: a check that finds no row clears the key flag.
- NIT stated: a fresh 401 for an unrelated reason gets the sign-in sentence; the badge says "rejected" for it too.

## Review round 7 (opus): 0 blocker, 0 major, 3 minor, 2 nit. Every subscription.checkLive caller checked: none pays more
- MINOR fixed: a check of the default folder BY PATH reads the decoy .claude.json inside it, so the wrapper never
  hears it (round 6 had widened that from "can only clear" to "can accuse"). Only a check with no folder speaks for
  the default account. Latent today (every caller passes no folder for the default). Mutant red.
- MINOR fixed: the status route's step is overlayStuckCards, exported and tested on real job files: a sibling's 401
  marks the stuck card, a card that is not stuck is untouched. Mutant (empty evidence) red.
- MINOR stated: while a card is stuck, each poll's join re-reads the job file of each agent with an observation (the
  same reads accountOf does). Not a live check. Sharing one resolver across them would mean the card and the badge
  resolve agents from different account lists, which is the parity this slice exists for.
- NIT fixed (a comment): in production the background check's own answer lands after its readers told heard the same
  thing, so that line changes nothing there.
- NIT stated: an account that turns from a key to a sign-in within the hour keeps the key wording until the next check.
