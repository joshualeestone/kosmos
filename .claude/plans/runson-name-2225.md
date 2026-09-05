# #2225: the agent-detail "runs on" line shows the chosen account name

## The card
Follow-up to #2095 (account-name display). The agent-detail "runs on"
parenthetical (`web/index.html`) shows the path slug (`label`) for a named
OpenAI account instead of the human-chosen name the pickers/Settings row show
since #2095. Mona Lisa investigated the display-only workaround (resolve
`a.account.dir` against the client `ACCOUNTS` global) and backed it out: it has
a cold-open timing hole (`openDetail` renders synchronously and never warms
`ACCOUNTS`), so it would show the name only when Settings happened to be open.
She specified the clean fix (engine + a trivial display change) and released her
claim. This builds that.

The first-run "Added" toast half of #2225 is OUT OF SCOPE here: it needs a
design decision on whether first-run collects a name at all. Left open.

## The fix
Two edits, no new coupling.

1. **Engine (`accountForAgent`, server.js).** The board's per-agent `a.account`
   is this function's return. It returned `{dir, email, label, organization,
   isDefault}` with no `name`. Add `name`, read from the same `.kosmos-name`
   sidecar the accounts API serves, via `openaiAccounts.readName(dir)`. Added to
   BOTH return branches:
   - the `found` branch (dir matched in the Claude `known` list) uses
     `readName(found.dir)`;
   - the fallback branch (dir NOT in `known` -- the OpenAI/codex case, since
     `accounts.list()` is Claude-only) uses `readName(dir)`. This is the branch
     that actually fires for the card.
   `readName` returns null when there is no sidecar (every Claude dir today), so
   the field is a no-op there and never stands in for `email`/`label`.

2. **Display (`web/index.html`).** The runs-on parenthetical logic is lifted
   into a pure helper `acctParenthetical(a)` = chosen name -> email -> slug,
   returning '' when nothing identifies the account. `openDetail` calls it. The
   name is present at render time because it rides the board poll data -- no
   cross-module `ACCOUNTS` lookup, no timing hole (which is why the engine fix
   is correct and the display-only workaround was not).

## Why the whoami route is untouched
`accountForAgent` is also consumed by the whoami status route (server.js ~633),
which hand-picks fields off the record (`{email, label, organization, dir,
isDefault}`) and so does NOT forward `name`. Its shape is unchanged. The only
new consumer of `name` is the board's raw `a.account`. A parity control pins
that the whoami route still drops `name` (a future change wanting the name in
the whoami sentence must add it to ALL that route's branches, not just one).

## Tests
- `server.runson-name-2225.test.js` -- pins `accountForAgent` directly (exported
  for this). A named codex account carries its name (fallback branch, the card
  case); an UNNAMED account is name null (control: the sidecar read can return
  null, so the pass is not vacuous); the found branch reads the sidecar too
  (both branches carry the field); and a fleet-card parity control that the
  whoami record path still drops `name`.
- `web.runson-name-2225.test.js` -- executes the extracted `acctParenthetical`
  helper: name wins over the slug, falls back to email then slug, an empty name
  does not stand in for the email, and an account-less agent renders no
  parenthetical (falsy '').
- Updated `server.test.js` runs-on-box test: it evals the runs-on slice, which
  now calls `acctParenthetical`, so the helper is grabbed into the eval scope.

## Weakest premise
The engine reads the sidecar per-agent per-poll (one small `fs.readFileSync`),
which is the same order of cost as the `create.readJob` this function already
does per agent; acceptable and consistent with the file's existing per-agent
reads. If it ever mattered, the sidecar read could be folded into the cached
`accounts.list()` read, but that would couple the codex sidecar into the Claude
accounts module, which is the wrong seam.

## Deploy note
Main is red on the pre-existing #1732 pathext guard (runners.js:225, another
agent's fix in flight on `pathext-allow-1732`). Every PR's CI is red until that
lands; this branch adds no new failures (full suite: only that one #1732 fail).
Merge waits on main going green.
