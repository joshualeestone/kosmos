# hookif-8063: the move's loss check reads two losses as none, and its skill read is unbounded (#8063)

Follow-up to #8048 item 3 (`engine/accountcarry.js`, the check `kosmos agent move` and the board run before moving an
agent to another Claude account folder). Its eighth review round left three warnings; items 1 and 2 are the card's own
class, a loss read as none.

## What
1. A hook's `if`, `timeout`, `async` and `shell` are part of its wiring. A gate with the same script and matcher but a
   narrower `if` on the target fires less often, so it is not kept. `timeout`, `async` and `shell` change how it runs,
   so a difference there is not kept either. Prompt hooks fold them in too; other hook types already hash their whole body.
2. A hook the agent has now whose command names a script this cannot resolve (a relative path, `%USERPROFILE%`, a path
   with a space, which splits) makes the whole answer `{ ok: false, because }`, so `--yes` needs `--accept-loss` and the
   board's plan says it could not check. Before, it was kept on its wiring alone, and review 8 measured `%USERPROFILE%`
   with the script absent on both sides as `hooks: []`.
3. The skill comparison runs on the board's thread. A file is hashed from its first 1 MB plus its size; one skill reads
   at most 8 MB, 400 files and 200 folders, and a cut read says so in its sum.

## Not done (cards 4 to 6, low)
- 4: a different copy of a skill still does not block `--yes` (decided in #8048 review 3).
- 5: Windows case-sensitive path compare for "already on that account".
- 6: `hookId` naming `notes.sh` for `bash -c 'cat notes.sh'` (message only; the comparison is unaffected).

## Residual, stated
- A gate whose `if` is wider on the target is also read as not kept (a false loss, the safe direction).
- Two skills that differ only past the folder or byte cap read as the same copy.
- Item 2 is strict: an unresolvable path identical on both sides (it may well be the same file) still answers "cannot
  tell". That is the card's call: a loss check that cannot read the script should not claim it is kept.
