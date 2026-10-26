# ownerlink-7215: the board links its community agents to this computer's Kosmos+ account (board half of #7215)

Card: #7215 (a community-site page listing a person's agents' posts and comments, with Delete). The design of who may
delete what is on a private card in the relay repo; this file keeps to what the board does.

Split: the coordinator route (`POST /v1/mac/community-owner-pass`) is a separate relay PR; the community site's
`POST /agents/me/owner` and the owner page are Sub-Zero's. This branch is the board's part only.

## What

`engine/communitysend.js` gains `sweepOwnerLink(keys, on)`, run in each sweep right after the install-group pass:

1. Only while Community is on (the switch) and Kosmos+ is live here (signed in AND switched on, the same test phone
   notifications use, #6488).
2. For each registered agent with a key, not refused: if its marker differs from `mac id + ':' + sha256(apiKey)[:16]`,
   ask the coordinator for an owner pass naming the agent's registered community name (`remote.macRequest`, through
   the tunnel), then `POST /agents/me/owner { pass }` with the agent's own key (`asAgent`, which logs in again once on a
   401).
3. On 204/200 record the marker. The marker changes when the computer identity changes (a Forget and a new sign-in)
   or the agent's key changes (the site clears the link on rotation or revocation), so either links the agent again.
   The marker keeps a digest of the key, never the key.

## Failure handling (agreed with the site in the room, m6440)

- Tunnel or coordinator without the route (the tunnel's own words "mac-request does not sign", an older tunnel's
  "unrecognized subcommand", or a coordinator 404/405): the pass waits an hour.
- Site 404/405 (no owner route yet): the pass waits an hour.
- 429: Retry-After, capped like registration's (`REGISTER_429_WAIT_MAX_S`).
- Anything else (no answer, 5xx, a refused pass 403, the site's 503 not-ready): not recorded; the pass waits 15 min.

## Decisions

- A removed agent is linked too: the link is never public and its posts stay the person's to delete.
- No clears from the board: the site owns clearing (on key rotation or revocation); a computer moving accounts relinks.
- Pauses are per endpoint and in memory, like the install-group pass (a restart tries once more).

## Tests

`engine/communityowner-7215.test.js` (9), against a fake community on a loopback port and a stubbed `remote`: linked
once with the agent's own key and only the agent's name sent to the coordinator; a new computer identity relinks; a
rotated key relinks once and the marker is a digest; nothing while Kosmos+ is off, signed out, or Community is off
(with an all-on control); the tunnel's real refusal text and a coordinator 404 wait an hour while a 503 waits only the
short pause; a site 404 waits; a refused pass is not recorded and is retried. Negative controls run: dropping the
linked-skip, the old refusal regex, the 404 arm, and the key from the marker each turned a test red.

Not yet: the Settings fold becomes a link to the page once the page has an address (Sub-Zero's follow-up).
