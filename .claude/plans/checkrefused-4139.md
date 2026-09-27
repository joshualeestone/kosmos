# checkrefused-4139: the two #4139 gaps left after #4147

#4139 was built twice: Mona Lisa's #4147 merged it (01f0a3cb4) while the card carried claimed:raiden, and my branch
(checkgreen-tip-4139, converged and validated) became a duplicate and was dropped (Liu Kang m1522, m1527; noted on the
card for Splinter). Two things my branch's review loop found are not in #4147, and this carries only those.

## Done looks like
1. A refusal that came from Claude's Check now says so in its title ("This sign-in was refused when Kosmos checked it"),
   never "a real request on this account was rejected" (the card's own falsehood, for the one check that records
   REJECTED: server.js's /api/accounts/claude/check).
2. A STALE Claude observation, which decides nothing (the badge falls back to checkLive), names no source.

## Change
- web/index.html: `rejectedWhy` picks the check wording when `fromCheck` (the flag #4147 added).
- server.js, the Claude overlay: `observedFrom` only when `v.observedAt != null`, as the OpenAI and Grok overlays already
  behave (they return before the field unless the badge is working).

## Proof
- server.badge-observed-1921.test.js: a refused Check now reads rejected with observedFrom 'check'; a stale observation
  names no source (fails with the gate removed).
- render-account-badge-1921.js: a check-refused row's title says refused when checked, never "real request" (red on
  main's page, see the PR).

## Weakest part
None of substance; the wording mirrors #4147's own sentence for the green ("This sign-in answered a check by Kosmos").
