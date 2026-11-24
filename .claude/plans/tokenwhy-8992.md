# tokenwhy-8992: kosmos feedback pull says "not filed" only when the token is not filed

Finished means: `kosmos feedback pull` says "not filed yet, file it with /add-secret" only when the secrets map has no
vercel-blob-feedback target; when reading a filed token failed or timed out it says to run the pull again and not to
file it; a test covers each case.

## Measured (2026-11-24, this machine's secrets-map.sh)
- `lookup <filed target>` exits 0; `lookup <unknown target>` exits 1 with "no credential mapped to target".
- `value <unknown target>` exits 1 with the same wording; `value <filed target>` exits 0 with the token.

## Built
- engine/feedbackpull.js tokenReading(): { token } or { why }: missing (lookup says "no credential mapped"), unread
  (lookup exits 0: filed, the read failed), unsure (the lookup did not answer either), no-tool (no secrets-map.sh at
  either place). token() keeps its shape. pull() returns `why` and a message per why (noTokenBecause).
- The map is asked through an injectable spawnSync-shaped runner (setSecretsRunner), excused in engine.reachable.
- Tests: engine/feedbackpull-tokenwhy-8992.test.js, one per case, plus the real tool's lookup wording pinned (skipped
  where there is no secrets-map.sh). Mutations checked: unread-as-missing, dropping the wording check.

## Decided
- "missing" needs BOTH exit 1 and the "no credential mapped" wording: exit 1 alone is not proof (a refusal also exits 1).
- An empty value at exit 0 is not a token: asked about like a failed read.
- Rejected: retrying the read inside the pull (hides a slow map and doubles the wait); the message tells the agent.
## Weakest premise
The "no credential mapped" wording is the tool's, not ours; a wording change makes "missing" read "unsure" (which says
run again and check lookup), the safe side. The real-tool test pins the wording where the tool is installed.

## Round 1 (opus) fixes
- 'misfiled': the target is in the map but lookup shows "consume: BLOCKED" or more than one credential; the message
  says fix the filing, not run again (a persistent fault must not read as transient).
- "no credential dir at" (no secrets folder) is missing too, as the tool says.
- A first copy that cannot be started or does not know the verb (usage exit 2) lets the second place answer, as before
  #8992; a timeout answers at once, so the wait stays one read plus one lookup (16 s worst case, the old worst case).
- 'unread' adds: if it fails again, `secrets-map.sh lookup` says why.
- Tests: a part printed before a timeout is never used; the real tool driven through tokenReading with SECRETS_DIR at an
  empty and an absent folder (never the real one). Mutations checked: misfiled, nodir, fallback, partial token.
