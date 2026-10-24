# acceptkey-6596: #6596 step 8, slice 2, board half (engine)

Card: joshualeestone/kosmos#6596 (security hardening O04-1, detail private). The relay half merged as kosmos-relay
PR 585: a registration that meets a coordinator key different from the pin, with nothing vouching for it, fails with
PinMismatch, whose message ends " (the key it offered: <key>)" in the pin's spelling (43 characters, base64url, no
padding). The key is named only when this computer holds no signed service key set. The relay takes that same
spelling in KOSMOS_EXPECT_COORDINATOR_KEYS, and a key on that list vouches for the change.

Today no recovery key ships, so the relay never refuses this way: the slice lands before activation, as planned.

## The call
1. `remote.offeredKeyIn(text)`: the key after "the key it offered: " ANYWHERE in the text (the relay's message can
   arrive wrapped in context, so not only at the end of a line), up to the closing parenthesis; null unless it is
   exactly 43 base64url characters that decode to 32 bytes. Tested against the board's own literal copy of the label.
2. A failed registration run (runSetupComplete, which both setups share, and the in-app register) carries
   `keyChanged: { offered }` when its error names a key. Only those runs: no other verb is asked.
   The board also checks its own trust state: when this computer holds a service key set FILE (any, usable or not;
   it errs to "held"), no key is offered for acceptance even if a message names one, matching the relay's rule that
   a key contradicting a signed set is never put to a person.
3. `remote.acceptOfferedKey(key)`: holds the key IN THIS PROCESS (not in the settings file, whose fields are a fixed
   list, and a board restart costing one more press of Accept is the safer failure) once it passes the same check.
   The code a sign-in uses is spent at the first attempt, so acceptance cannot retry that run: the NEXT registration
   run (opts.register: setup complete, company setup, signin register; no other verb) passes it in
   KOSMOS_EXPECT_COORDINATOR_KEYS, after the shipped set's keys when there are any. One-shot: taken when that run
   starts, whatever its outcome. Voided by Forget, and ignored after an hour.
   NOT voided by Start over or Sign out (signinCancel, the sign-in epoch): the page's Start over calls signin-cancel,
   and Start over is how the person gets the new code the accepted key is for. My first draft tied it to the epoch;
   that would have made the feature unusable on its main path.
4. A route for the page, POST /api/remote/accept-key { key }, guarded as the typed-code Allow: refused from a
   remote session (REMOTE_NOT_ALLOWED.acceptKey), and made on this computer (loopback peer, loopback Host and Origin,
   no forwarder), with its own board session, by a person at the screen (no agent token). The answer to a refused
   sign-in carries `keyChanged: { offered }`, so no status field is needed. The screen itself (wording, both
   fingerprints, Accept, then Start over) is the next slice, through a design review.

## Review 1 (fixed)
- An acceptance was not tied to a key the connector offered, and under the shipped list it widened that list (the
  relay never names a key under a list: it refuses with "not on the signed list" or vouches). Now: the board records
  the key a refusal named, with when; only that key, within the hour, can be accepted; acceptance is refused under a
  shipped list; and setupEnv never adds an accepted key to the shipped list.
- A list of the accepted key alone refused the pin itself (a rotation undone within the hour): the pin held is now
  named beside it.
- The last-line fallback could read one key out of a text that named two across lines: `because` is read only when
  there is no stderr.
- An Accept during a Forget in flight survived it: refused while forgetting, and Forget clears the offer too.
- The route test could not fail on the cookie or the loopback guard: a second test enforces the board token (a
  header token is not the app window: 403; the session cookie: 200). The loopback-peer guard stays untested (every
  test request is loopback); the madeOnThisComputer guard beside it is tested.
- Kept: the accepted key is spent by the next registration run whatever stops it (a mistyped code included). Using
  it once is the property; the screen's copy (next slice) says Accept is for the next sign-in.

## Review 2 (fixed)
- The three registration routes (setup-complete, company/complete, signin-register) answered a failure with
  `{ error }` only, so `keyChanged` never reached the page and the plan's "the answer carries it" was false at the
  HTTP layer. Each now forwards it; a route test drives all three with a refusal that names a key and one that
  does not (arm C1: one route's forwarding removed is red).
- An offer outlived its use: it is now cleared when accepted (a second Accept needs a second refusal, arm C2) and
  by any registration that goes through (setup paths through withKeyChange, arm C3; the in-app register clears it
  on its own success path, untested for the same reason as its keyChanged).
- Kept: the acceptance is spent by whichever registration runs next, not only the person's own retry (a company
  finish or a second name). It vouches only for the key accepted, so the cost is one more Accept, not trust.
- My own test edits for C2 made the Forget test vacuous twice (the second Accept was refused, then a re-offer spent
  the acceptance before the Forget). Split into two arms, an offer then Forget and an acceptance then Forget; A6 and
  B6 re-run red against the new test.

## Review 3 (fixed)
- A signed set arriving after the Accept (a ticket fetch stores one while the old registration still runs) did not
  void it: the next run named the key, the connector took it as vouched and forgot the set, the one thing this
  slice must never cause. takeAcceptedKey now re-checks for a held set when the run starts (arm D1).
- The test line "nor accepted" passed for the wrong reason (no offer is recorded under a set, so the first check
  refused). Now: refuse with a key, THEN write the set, then Accept, and assert the set-held refusal (arm D2, which
  the old test could not see).
- A registration that goes through now ends the acceptance as well as the offer, so an Accept made while a
  registration was already out (that run spawned without the key) does not vouch at a later run nobody asked about
  (arm D3; the test holds the fake registration open with a gate).
- Deferred: a third key, offered while an acceptance is passed, is refused by the connector as "not on the signed list
  this version of Kosmos came with", which names no key and so offers no Accept. That wording is the relay's
  (expected_coordinator_key); the board cannot honestly rewrite it. Recovers at the next attempt. A relay follow-up
  can name the key there too.
- Corrected: review 1's "refused while forgetting" is defence in depth, not a reachable guard: Forget clears the offer
  before it sets its flags, so the earlier "not a key Kosmos+ offered" check always answers first. Kept, untested.

## Review 4: no blocking finding; recorded
- A registration that succeeds while the sign-in epoch moved returns through cancelledAfter before the success clears
  the offer, so K stays acceptable for the rest of the hour. Kept: the acceptance itself was spent at spawn, an Accept
  then vouches only for K at one later run, and the page offers Accept only beside the refusal that named it.
- An unrelated failure (a mistyped code) does not end the offer. Kept: the offer is re-recorded on every refusal that
  names a key, and the hour bounds it.
- The hour test cannot see the "clock moved back" half of fresh(), and the forgetting guard is unreachable (review 3).
  Kept as defence in depth.
- Any failing registration whose stderr carries the label yields keyChanged, not only PinMismatch. Kept: the plan's
  weakest premise covers a forged message, and nothing a person controls (the name rule) can carry the label.
- One narrow race stays: a set landing between takeAcceptedKey and the connector reading its own folder.

## Rejected
- The board writing coordinator_pubkey itself: bypasses the tunnel's store and floor discipline.
- Parsing the key from any setup verb's error: a verb that echoes service text could show a forged prompt.
- Keeping an acceptance until used: an old Accept would silently vouch for a key at some later sign-in.

## Weakest premise
A person can judge whether to accept a changed key. The screen's copy (next slice) must say to accept only a change
they expect. A coordinator that forges the message gains nothing it could not get by offering a key for real: in
both cases the person's Accept is the decision.

## Tests (engine/acceptkey-6596.test.js)
The parse (wrapped, mid-line, at the end, wrong length, not base64url, two labels); keyChanged on a registration
failure and not on another verb; none while a set is held; acceptance stored, passed once with and without shipped
keys, cleared after the run, by Forget, and when stale; refused for a key that does not parse.

## Arms ($S/ak-arms2.py: the file mutated in place and restored; control = the unmutated run, 13 pass)
engine: A1 no keyChanged on setup, A2 a held set not seen, A3 any verb takes the key, A4 not one-shot, A5 no expiry,
A6 Forget keeps it, A7 two labels read, A8 non-canonical spelling read, A9 only at the end of the text, B1 any key
accepted, B2 accepted under a shipped list, B3 the shipped list widened, B4 no pin beside it, B5 last-line fallback
always, B6 Forget keeps the offer: each red on its named test.
route: R1 no remote refusal, R2 no on-this-computer check, R3 no screen check, R4 no cookie check: each red.
Not covered by a test: keyChanged on the in-app register path (signin register), which needs a whole signed-in
session to reach; it is the same one-line withKeyChange call as the setup path, which is tested.

## Progress
- [x] engine, route, tests, arms (14 engine + 3 route tests). Sweep after review 2 (load ~12, another suite running):
  1,374 pass, 5 fail, all timing tests (a hung tunnel, the #988 end to end, a c3 offer); their 3 files alone: 110 pass.
- [x] challenge-loop: 4 rounds, the last with no blocking finding
- [ ] validation, PR (after orgkeys-6596 merges: this branch is stacked on it)
