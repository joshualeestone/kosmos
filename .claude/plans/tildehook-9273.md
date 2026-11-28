# tildehook-9273: a hook written with ~ is not read as a loss on Windows (kosmos#9273)

## Bug
Moving an agent to another Claude account compares the source account's hooks with the target's. Each hook's
arguments are made one spelling first (`~`, `$HOME`, the folder, `$CLAUDE_CONFIG_DIR`). On Windows, `~/.claude-a/state`
expanded by string keeps its "/" (`C:\...\home-1/.claude-a/state`), while the folder it is split on is
`path.resolve(dir)` with "\" (`C:\...\home-1\.claude-a`). The folder was never found, so the same hook spelled `~` in
one account and `$CLAUDE_CONFIG_DIR` in the other read as a loss. Measured on windows-latest (run 46115766861):
`engine/accountcarry-8048.test.js` review 6, actual `[ 'echo ~/.claude-a/state' ]`, expected `[]`.

## Change
engine/accountcarry.js: `oneSep`, which on a host whose separator is "\" turns "\" into "/", is applied to both sides
of each comparison in `one()` (shell hooks) and `oneX()` (exec hooks): the expanded argument, the folder and the home.
Elsewhere it is the identity, so macOS and Linux are untouched (a "\" is a filename character there).

## Rejected
- Expanding `~` with path.join (which would use "\"): a command written with "/" after the folder would still differ.
- Normalising in every caller: the two key builders are the only places spellings are compared.

## Weakest premise
That "\" and "/" name the same path wherever a hook's argument is compared on Windows. True for Windows paths; a hook
argument that is not a path and differs only by a "\" against a "/" would now read as the same hook there.

## Validation
macOS: accountcarry-8048 25/25 (unchanged behaviour). Windows: the review 6 arm that was red must go green.
