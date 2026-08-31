# #1659: build the Claude half of account removal

## What finished looks like

A person can remove a Claude account from Settings, the button is not disabled,
and it behaves the same way the OpenAI Remove beside it already does: it refuses
while agents are running on that account and names them, it forgets rather than
deletes, and it says which of those two it did.

## Why this was open

Josh, 2026-08-31 09:19: the button answered "Disconnect is not built." That was
honest rather than forgotten. `web/index.html` carried the reason in its own
title text: disconnecting "has no way to tell agents on it to stop first".

**That reason stopped being true when #1372 shipped.** The OpenAI route already
enumerates the agents on an account and refuses while any is on it. The card
framed this as an open design question; it was a design question that had
already been answered on the other provider and never carried across.

## The call I made, and what I rejected

The card offered three behaviours. I first chose "disconnect and stop those
agents", then **reversed it after reading the code**: the OpenAI half ships
"refuse and name them", and two buttons in one row builder, under one word,
must not mean two different things depending on a provider the person is not
thinking about. Consistency beat my abstract preference.

Rejected:
- **Stop the agents.** Diverges from the shipped sibling for no gain.
- **Leave them running.** Fails in the quiet direction: agents keep working
  authenticated against a thing that was removed, and fail later, elsewhere,
  unattributably.

## The one deliberate asymmetry

`forgetAccount` **refuses the default `~/.claude`** where the OpenAI one allows
`.codex`. Measured: `prepare()` symlinks every account Kosmos makes at
`~/.claude/projects`, and on the fleet machine two other accounts had both
`projects` and `settings.json` linked into it. Moving the default strands the
history of accounts nobody asked to remove, and the button that did it cannot
undo that.

## Shape

- `engine/accounts.js` : `forgetAccount(dir, usedBy)`, renames to
  `.removed-claude-<label>` with a collision loop so a second removal of the
  same label cannot clobber the first one's sign-in.
- `server.js` : `DELETE /api/accounts/claude`. The enumeration is **copied**
  from the OpenAI route, not re-derived, so Renet Tilley's #1447 fail-closed
  fix comes with it.
- `web/index.html` : both buttons carry `data-forget-provider`, one handler
  reads the endpoint off the button. No second handler to drift.

## Verification

- 13 tests: 6 on the engine function, 7 on the route.
- **6 perturbation arms**, each breaking one guard and confirming the matching
  test goes red, then restoring clean: default refusal, usedBy refusal, path
  guard, collision loop, runner filter, fail-closed.
- A route DISCRIMINATOR arm: an agent on a **different** account must not
  block, or the button would be unpressable on a busy machine.
- Full suite: 3267 pass, 0 fail.

## Known gap

**No browser check.** The shipped OpenAI handler carries a repaint-ordering fix
that the browser gate caught and no server test could see. My change reuses that
handler rather than adding a second one, so the ordering is inherited, but the
Claude button itself has not been clicked in a browser. Recorded rather than
claimed.
