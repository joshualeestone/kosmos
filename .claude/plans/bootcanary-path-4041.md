# The boot-file size canary measures the text, not the checkout path

**Branch:** `bootcanary-path-4041` · Card kosmos#4041 (a #4021 follow-up, found by Ice Cream Kitty)

## What was wrong

`engine/create.test.js` "a role-made boot file is nowhere near the size its reader refuses" asserts
the pm boot file stays under MAX_BYTES / 6. The boot file embeds two absolute paths that belong to
the machine running the test: the kosmos CLI (four times, in the msg/post/reply lines; on a source
checkout, `<repo>/install/kosmos`) and the agent's Files folder (under the sandboxed workers root).
So the byte count moved with the checkout path.

Measured on one commit with the same swap the test now does:

| checkout root | raw bytes | measured text |
|---|---|---|
| 7 chars (`/tmp/kz`) | 32,483 | 32,490 |
| 55 chars (this worktree) | 32,643 | 32,490 |
| 204 chars (scratch) | 33,239 | 32,490 |

756 bytes of swing from the path alone, on a check whose job is to flag growth of the text.

## Decision

Measure the canary on the text with each machine path swapped for what a real install on a fixed
home (`/Users/person`) writes: the CLI becomes `/Users/person/.local/share/kosmos/bin/kosmos`
(setup.sh's default KOSMOS_HOME), and the workers root becomes `store.workersRootFor({},
'/Users/person', 'darwin')`. Keep the `bytes <= MAX_BYTES` assertion on the RAW file, because the
reader refuses raw bytes.

Two guards so the swap cannot quietly stop working:
- each swapped path must be present in the raw file (a swap that matches nothing would read as fixed
  while measuring the path again);
- after the swap, no sandbox, checkout or home path may remain (a newly embedded path would make the
  number path-dependent again).

**Rejected:** a looser threshold (hides the noise instead of removing it); a regex for "anything that
looks like a path" (would also rewrite paths that are part of the ruled text); measuring from a fixed
checkout location in the test (cannot move the repo from inside its own test).

## Red checks (scratch copy, not this worktree)

- Files-path swap removed: fails with "embeds another machine-specific path".
- CLI swap pointed at a path that is not in the file: fails with "no longer carries the kosmos CLI path".

## Weakest premise

That `/Users/person` plus setup.sh's default KOSMOS_HOME is the right "real install" to measure. It
only sets the absolute level; any fixed choice makes the number path-independent, which is the point.
A person with a very long home path gets a larger real file, and the raw `<= MAX_BYTES` check still
covers the reader's actual limit.
