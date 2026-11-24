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
  #8992; a timeout answers at once, so a hung tool costs one read plus one lookup at that place (16 s); a broken first copy that is also slow adds the second place's wait.
- 'unread' adds: if it fails again, `secrets-map.sh lookup` says why.
- Tests: a part printed before a timeout is never used; the real tool driven through tokenReading with SECRETS_DIR at an
  empty and an absent folder (never the real one). Mutations checked: misfiled, nodir, fallback, partial token.

## Round 2 (sonnet) fixes
- 'unread' only when lookup shows exactly one credential whose consume line is `secrets-map.sh value <target>`; any
  other consume line (BLOCKED, env, path, undeterminable) is 'misfiled' (value refuses those every time). Every consume
  line was read from secrets-map.sh's lookup.
- The misfiled message also names the file's mode (the not-readable case).
- The real-tool test puts that tool's folder first on PATH, so the copy found is the one checked.
- Tests use the real lookup report shape (FILED); mutation checked (dropping the consume match).

## Round 3 (opus) fixes
- 'tool-broken': a secrets-map.sh that cannot run `value` (not executable, an old copy, a usage exit 2) at every place
  says update it with /agent-refresh; never "run again" (it would fail forever) and never "file it".
- The real-tool test never lets a token reach an assertion message (asserts only that none came back, then the why).
- 'missing' adds: if you believe it is filed, run `secrets-map.sh audit` first (an unreadable header looks unfiled).
- A test that the token the map gives is the one the pull sends; the test's temp folder is removed; "Review N" labels
  dropped from new comments; the wait note made exact.

## Round 4 (sonnet) fixes
- BLOCKER fixed: `value` exits 2 both for an old copy's unknown verb and for refusing a filed shape (an env file).
  Only "unknown subcommand 'value'" is tool-broken; any other exit 2 goes to the lookup, which says misfiled.
  Measured on the real tool with FAKE credentials in a temp SECRETS_DIR: env-shaped -> misfiled; bare fake -> read.
  Kept as a test (fake values only).
- A non-zero exit never yields a token (comment: Kosmos reads the whole output, so it is not the tool's broken-pipe case).
- Slip, recorded: while measuring I ran `secrets-map.sh generate` once without SECRETS_DIR, which regenerated the real
  map README (the idempotent rebuild /add-secret runs; headers only, no values). Checked after: 107 rows, the target
  listed, lookup reads it as a bare token.

## Round 5 (opus) fixes
- 'unreadable': "no credential mapped" while the secrets folder, or a file in it, cannot be read from here (a sandbox
  refusal looks exactly like a missing target): run the pull where it can read them; never "file it". Checked with
  metadata only (a listing and an access check).
- The fleet's own copy (~/.claude/scripts/secrets-map.sh, what /agent-refresh installs) is a third place; 'no-tool'
  names all three and says install it with /agent-refresh, never file the token.
- 'cannot-run' (a copy that could not be started: EACCES, EPERM, as in a sandbox) is apart from 'tool-broken' (an old
  copy without `value`): run where it can run vs update it.
- 'unread' no longer promises lookup explains a repeat failure (lookup just said the filing is healthy); it says the map
  is slow or busy here, try when less busy.
- The real-tool control never echoes what it read; a test that the "no credential" wording needs exit 1 too; test
  names carry no review-round labels. Mutations checked: readable, cannot-run, third place.
