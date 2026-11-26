# expirywhy-9107: follow-ups to #9097's off-macOS login expiry reader (kosmos#9107)

**Posture:** production (the board on Windows and Linux). **Status:** what has run is on the card (kosmos#9107).

**Finished looks like:** off macOS, a board that shows no Claude login warning says why in its log, once per kind, with
no path or name; the guards test's control holds on a Windows runner whatever the home's spelling; and the board's
snapshot no longer reads the credentials file itself. It still reads the account list and each account's `.claude.json`
from the same home (status.js computeLoginAdvisories), so a stalled home can still hold it there: item 4 is the
credentials file only (review 1).

## Decided
- Item 1, the words: four kinds (a named account with no folder, a sandboxed board, no readable home, a folder outside
  the home), each said once per board run through `console.error` like communitysend's `logOnce`. No path in any line,
  since a path can carry the user's name. The `node --test` refusal says nothing: only a test run meets it, and nobody
  reads a board log there. Under `node --test` the default log is silent; tests set their own.
- Item 2: the guards test watches the real file by its resolved, case-folded path, and watches `fs.readFile` as well as
  `fs.readFileSync`, because after item 4 the board's read is the asynchronous one. Without the second watcher the
  control would read nothing and the guard checks above it would pass for the wrong reason.
- Item 4: off macOS the synchronous reader answers from what a background `fs.readFile` last found (`fileBodyNow`), and
  starts the next read when the last is a minute old, or when the login generation moved since it (a sign-in; review 1,
  else the old notice stayed up for the advisory cache's 5 minutes, the #5018 complaint), and none is in flight. The
  first answer for a file is null. A read that finds a new refresh-token expiry moves the generation, so the advisory
  cache recomputes on the next snapshot; an access-token refresh alone does not (it rewrites the file every few hours).
  A read that never returns holds back only that file's next read. macOS is unchanged (the Keychain read already has
  its 5 s bound).
- The tests that check which file is chosen pass a direct read (`readNow`); the background read has its own tests.

## Rejected
- A bounded synchronous read through a child process (as macOS's `security` call): one process per account per
  snapshot refresh, to cover a case (a stalled network home) that a background read covers for nothing.
- Logging the refused path: it names the user.

## Weakest premise
- That a login warning up to one snapshot late after a board start is acceptable. The warnings are about days, and the
  `loginChanged()` call brings it to the next snapshot once the read lands.

## Not done here
- Item 3 (compare the launch job's folder with a running Windows agent's own CLAUDE_CONFIG_DIR) needs a Windows box with
  one agent per account. Not measured; it stays open on the card.
