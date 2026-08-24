# A second Claude account with no terminal: the engine half (#248/#324)

## What finished looks like

Pressing "Add another account" in Settings > Accounts starts the same
guided sign-in the first run uses, pointed at a fresh account directory.
When it completes, the new account appears in the Accounts list with its
memory shared from birth. The existing single-account flow behaves byte
for byte as today when no directory is passed.

## The frozen contract (sent to Mona Lisa 2026-08-23, unchanged)

- connect.start(opts), opts.configDir optional absolute path. Absent =
  today's env-seam behavior byte for byte.
- The flow CARRIES its dir: it rides the persisted flow state, the tmux
  launch's CLAUDE_CONFIG_DIR prefers the flow's dir over the env seam,
  and the flow's OWN subscription checks read <configDir>/.claude.json
  (subscription.check gains an optional {configDir}; absent = today's
  resolution). The two seams travel together per call.
- accounts gains nextWorkDir(): the first free ~/.claude-workN, where
  free means the directory does not exist OR exists with no identity
  (an unclaimed leftover from a cancelled attempt is reused, so cancels
  do not litter work2, work3, ...).
- state()/publicView echo configDir (null for the global flow).

## Changes

- engine/subscription.js: readConfig takes the file; check(opts) resolves
  <configDir>/.claude.json when given, CONFIG otherwise.
- engine/connect.js: start(opts) validates an absolute configDir (throws
  on a relative one; the route's catch answers 500), a module-level flow
  dir rides every writeState so the record and publicView carry it (one
  flow at a time by design, same shape as the driver singleton), all
  three subscription flip sites (the start early-exit, the unknown-grace
  catch-up, the press-enter finish line) consult the flow's dir, and the
  launch env prefers the flow's dir over AGENT_WORKFORCE_CLAUDE_CONFIG_DIR.
- engine/accounts.js: nextWorkDir() as contracted.
- server.js: POST /api/connect/start accepts an optional JSON body
  { another: true }: it picks nextWorkDir(), runs prepare() (idempotent;
  wires the shared-memory symlink before sign-in so the account is right
  from birth), and starts the flow with that dir. No body = today's call.

## The differential that must hold

With the GLOBAL config connected and the flow's directory empty, a
start({configDir}) must NOT early-exit connected: the flow's own check
reads its own directory. That is the whole reason the two seams travel
together, and it gets its own test.

## Verify

- Full suite green, exit codes read from files.
- Screenshot of the enabled flow for the PR and channel.
