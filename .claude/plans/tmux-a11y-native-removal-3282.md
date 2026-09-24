# tmux-a11y-native-removal-3282: remove the dead onboarding tmux pre-register path

Card: kosmos#3282. Routed to me by Splinter (night shift 2026-09-24), over the card's
stale "Owner: Angel" field. Verified in the 09-24 served-bytes sweep that this was
UNBUILT: the routes were still present in served 0.6.90 server.js, and its blocker
(#3298, the web removal) had already landed.

## What this removes and why it is dead

The onboarding "pre-register the tmux Accessibility/Automation grant up front" path.
Its only trigger was the client `frFireTmuxA11yRegister`, which #3113/#3298 removed
from the web. With no caller left, the whole chain is dead code:

- `server.js`: the `POST /api/tmux-a11y-prompt` route + its `promptrequest.request('tmux-a11y')`.
- `engine/promptrequest.js`: the `'tmux-a11y' -> 'tmux-a11y-prompt-request'` REQUEST_FILE entry.
- `native-app/main.swift`: `"tmux-a11y-prompt-request"` in the watched-names list, its
  `consumeRequest` block in `checkPromptRequests`, and the `spawnTmuxAutomationPrompt` function.
- Stale comments in the `/api/tmux-a11y-status` route that described the removed register.

## Explicitly KEPT (do-not-over-reach, per the card)

- `/api/tmux-a11y-status` (tmuxGrant, #2911) - the tmux Accessibility STATUS read that
  paints the onboarding row "Not activated" + Turn On. This is a read, not the register.
- The RUNTIME automation path in `engine/terminal.js` (osascript under an agent's tmux),
  which is how tmux actually acquires its Accessibility/Automation grant at first agent
  action. Separate from the onboarding pre-register; untouched.
- `spawnAxHatchUnderTmux` (the app-subject a11y / file-access hatch) and the a11y-prompt,
  file-access-prompt, and a11y-recheck request paths - all unrelated, all kept.

## Validation

- JS: `node --check` clean on server.js + promptrequest.js. Affected tests pass:
  engine/promptrequest.test.js, server.tmux-a11y-status-2911.test.js,
  server.a11y-status-regate-2559.test.js, native-app.a11y-writer-2125.test.js,
  web.firstrun-a11y-1214.test.js (36 + 11 tests, 0 fail). No test hits the removed
  route; no browser-check mocks it; promptrequest.test.js does not reference the removed key.
- Swift: `swiftc -parse native-app/main.swift` exits 0 via the Command Line Tools toolchain
  (DEVELOPER_DIR=/Library/Developer/CommandLineTools), so the edits are grammatically clean.
  The full native build + .pkg cut is Baron's release path (the card notes it rides a cut);
  this branch is the source removal.

## Rejected

- Removing `/api/tmux-a11y-status`: NO. That is the live status read (#2911), not the
  dead register; the card scopes the removal to the prompt/register only.
- Touching engine/terminal.js: NO. That is the runtime grant path, explicitly out of scope.
- Rewriting the removed comments into new explanatory prose: instead, deleted the stale
  claims and left short removal-marker notes pointing at what is kept, so a future reader
  is not told about a mechanism that no longer exists.

## Weakest premise

That no reachable caller of `/api/tmux-a11y-prompt` remains. Checked: the web trigger is
gone (#3298 served), a repo-wide grep finds no live caller (only removal-note comments),
no test posts to it, and no browser-check mocks it. If some out-of-tree client still POSTs
it, that client now gets a 404 instead of a no-op recorded-request - acceptable, since the
request was already consumed by nothing once the native consumer is gone.
