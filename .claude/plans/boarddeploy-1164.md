# #1164: the board stops running out of a git working tree

**Branch:** `boarddeploy-1164` · **Card:** kosmos#1164

## What was wrong

`com.kosmos.board` runs the board straight out of a git checkout, and `server.js` serves
`web/index.html` from disk per request:

```
ProgramArguments   /opt/homebrew/bin/node  /Users/agent1/work/agent-workforce/server.js
WorkingDirectory   /Users/agent1/work/agent-workforce
```

So saving an edit, or putting that checkout on another branch, changes what the person using Kosmos
is looking at, with no deploy step and no signal. #1051 recorded exactly that: the board served an
unmerged branch for about twenty minutes and nothing anywhere said so.

`tools/board-serving-check.sh` already makes that **visible** in one command and says outright that
it does not fix it. **This is the other half.**

## What I measured before writing anything, and one measurement changed the design

**An installed app copy already exists** at `~/.local/share/kosmos/app/`, and my first instinct was
that the fix is simply repointing the plist at it. **Measuring killed that:**

```
installed copy   version 0.2.36   mtime 2026-08-21   server.js 198,885 bytes
the tree         version 0.6.18                      server.js 412,342 bytes
```

⇒ Nine days and about ninety versions stale, because the release pipeline restarts the board from
the tree rather than reinstalling the app. **Repointing at it would have been a severe regression
wearing a fix's clothes.** That is the whole argument for measuring a thing before reusing it.

**Two facts make the real fix cheap, and both are measured rather than assumed:**

- **The app is dependency-free.** `dependencies: {}`, no `node_modules` anywhere, and `server.js`
  requires only `node:` builtins. Control: the same grep found 60 relative requires, so it could see
  requires at all. ⇒ A deploy is a copy of the app's own files and nothing else.
- **`server.js` relocates as a unit**, resolving siblings through `path.join(__dirname, ...)` with no
  `process.cwd()`. That was already answered in this card's comments and I did not re-derive it.

## What this adds

`deploy/install-board.sh`, modelled on `kosmos-relay/deploy/install-monitors.sh`:

- **dry run by default.** Nothing is copied and no job is touched without `--apply`.
- **refuses `--apply` from a dirty tree** (measured: exit **1**; control, the dry run exits **0**).
- **warns, but does not refuse, on a non-main branch.** Deploying a branch on purpose is legitimate;
  deploying an uncommitted edit is not, because nothing afterwards can tell you what it was.
- **names stale files** already in the destination, because a leftover engine module from an older
  deploy is loadable and looks like part of this one.
- **swaps rather than copies over**, so a failed copy cannot leave a half-updated tree the board
  would happily load, and it restores the old tree if the swap fails.
- **reads the plist back** rather than asserting what it wrote.
- **bakes the version into the page**, exactly as the bundle does and verified the same way, because
  without it the served page shows the literal `__KOSMOS_VERSION__` marker to a person.

## The duplication, and why it is guarded rather than refactored

The app file list now exists in two places: here and in `tools/build-kosmos-bundle.sh`. **Two copies
of one fact drift**, and this repo pays for that defect repeatedly.

I did **not** refactor the shared staging out of the bundle builder: that script is release-critical
and it is 22:00 on a Sunday. **The price of that choice is a guard**, and
`tools/test-board-deploy-manifest.sh` is it: the lists may live in two places but they cannot
disagree.

**Verified by perturbation, each arm restored afterwards:**

| perturbation | what fired |
|---|---|
| deploy drops a file the bundle ships | *"the bundle stages files the board deploy does NOT"* |
| deploy stages a file the bundle does not | *"they would never reach a user"* |
| the extraction breaks, both lists empty | **the control fires**, naming the vacuous pass |
| restored | 3 passed, 0 failed |

⭐ **The guard caught two defects in itself before it caught anything else**, and both are the week's
recurring class. It first compared the **whole** bundle to the app deploy and reported six false
differences, because the bundle also stages the installer and the native app: an instrument
answering an adjacent question. Then scoping it to the app section still failed, because
`/^# ---- the app /` **also matches** `# ---- the app can tell when it is the stale half` three
hundred lines later, which reopened the range and swept in the rest of the file. **The dashes in the
section rule are what separate a header from a sentence that starts the same way.**

## 🛑 NOT APPLIED, deliberately

I ran the dry run and **did not apply it**. Applying repoints the live board that eighteen agents and
Josh watch, and a board that fails to come back is worse than a board serving from a clean tree for
one more night. **The card is latent by its own measurement** (`branch=main dirty=0`).

⇒ **This PR ships the mechanism. It does not change what the board serves.** Applying is a
one-command, operator-timed step:

```
sh deploy/install-board.sh            # see exactly what it would do
sh deploy/install-board.sh --apply    # then confirm with tools/board-serving-check.sh
```

**Do not read "merged" as "deployed" here.** That distinction cost me a wrong card closure on #1554
the same night.
