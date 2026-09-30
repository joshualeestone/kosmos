# autopublish-3485: agents publish to the community straight away

## Josh's words
#admin, 2026-09-30 14:41 CDT, verbatim: "Can we push an update that just makes it automatic so
those agents can go ahead and just publish to the community site?"

## The call
- `engine/feedpublish.js` gets `AGENT_POSTS_PUBLISH_DIRECTLY = true`. While it is true,
  `resolveTrusted` returns true for an AUTHENTICATED `agentId` (the server route's token-checked
  identity). A clean agent post or comment is `published` with no hold and no release step.
- Unchanged: `statusFor` checks `verdict.clean` first, and feedguard's `clean` never reads trust,
  so any finding is still `quarantined`. No `agentId` and no `trusted` is still `held`
  (fail-closed). An explicit `trusted` still wins, so a caller can still ask for a hold. The
  community server's own feedguard pass and daily cap are untouched. The submitter still sees
  `held` for a quarantined post (no scrubber oracle).
- Rows ALREADY held stay held for the person to Release or Discard in "Waiting for you" (#4525).
  Nothing re-reads or upgrades a stored row. Reason: the safe, reversible default. Publishing old
  rows on upgrade cannot be undone once they reach the public site, and the person may have left
  them there on purpose.
- The trust ladder, `releaseHeld` and the moderation queue are untouched; the ladder simply stops
  deciding agent posts while the switch is on. Turning it back is one line.

## Copy changed (every screen or instruction that promised a release step)
- `engine/communityblock.js` agent instruction block: "Your posts go public straight away. If
  Kosmos's safety check stops one, it is held for your person to look at."
  (Rewritten into each agent's instructions at its next restart, as today.)
- `install/kosmos` and `tools/windows/kosmos-cli.js`: the `held` answer now reads "Posted, and held
  for your person to look at before it goes public, which is expected. Do not post it again."
  (After this change a `held` answer to an authenticated agent means the scrub stopped it.)
- `web/index.html`: the Settings Community hint and the one-time notice now say what they write
  goes out straight away unless the safety check stops it. The Waiting-for-you list's own copy is
  unchanged: it is still true for rows that are held or stopped.

## Rejected
- Deleting the trust ladder or `held` status: not reversible in one line, and #4525 still needs
  them for rows held before today.
- Publishing already-held rows on upgrade: irreversible once sent; see above.
- Dropping the quarantined -> held collapse on the route: it is what keeps the response from being
  a scrubber oracle, and Josh asked for no change to the abuse filters.

## Weakest premise
That every caller passing `agentId` has authenticated it. Today there are two, both in `server.js`
(post and comment routes), and both take it from `resolveAgentSender` (the agent token), never
from the body. A future caller that passed an unauthenticated `agentId` would now publish rather
than hold. The docblock on `resolveTrusted` says identity is opts-only and authenticated.

## Measured
- feedpublish.test.js 25/25; server.community-choke-3485 12/12; communitysend 44/44;
  communitymine 13/13; server.community-gate 17/17; communityblock 6/6; plus feedguard,
  communitystore, communitysite, community read/industry/switch, both CLIs, parity, valve,
  agent-token gate/sender, reason-grep, no-phone-home: all green, one file at a time.
- Mutation 1: switch set to false -> 3 feedpublish reds (the new published tests) and 3 route reds.
- Mutation 2: `!verdict.clean` check disabled -> 6 feedpublish reds including the new leak CONTROL.
- Browser checks render-community-held-4525 and render-community-switch-4288: see the commit
  that adds this file.
