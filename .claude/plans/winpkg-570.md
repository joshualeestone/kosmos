# winpkg-570: the unsigned Windows package Josh asked for

## His ruling, 2026-08-29

> *"Let's ship one unsigned to see it function and then let's walk through the
> process of what we have to do to buy a certificate."*

## What it produces

`dist/kosmos-win-x64.zip`, **35 MB**, 83 files. Built and inspected on this Mac.

```
Kosmos.cmd        the launcher
open-board.cmd    waits, then opens the browser
README.txt        what the security warning is, and that agents do not work
manifest.json     signed:false, agents_supported:false
runtime/node.exe  v24.19.0, checksum-verified against nodejs.org
app/              server.js, package.json, engine/*.js, web/, bin/
```

## Three real defects found by reading my own output

**1. I typed the wrong port.** The launcher opened `127.0.0.1:4319`. **The real
default is 16180.** A person would have got a connection error on a working
install. Now the builder **reads the port out of `server.js`** and fails the
build if it cannot.

**2. The browser opened before the server started.** The `start ""` was on the
line above the one that runs node. Now a separate `open-board.cmd` waits three
seconds, and the launcher prints the URL anyway so a failed auto-open costs
nothing.

**3. My own zip-contents assertion reported a good build as broken.**
`unzip -l "$ZIP" | grep -q " $want$"` under `set -o pipefail`: `grep -q` exits on
the first match, `unzip` dies of SIGPIPE, and the pipeline's status is the
failure. ⭐ **It only bit on EARLY matches**, so the four entries near the end of
the listing passed and it looked reliable. Measured three arms: pipefail + grep
-q FAILS, without pipefail OK, captured-first OK.

## The drift guard, and it shrank twice

Two builders staging one app is exactly #731 waiting to happen: the codex bridge
was resolved by the engine and never staged, and served 0.5.23 could not create a
single agent while the refusal blamed something else.

The test compares the two file sets. **Differences must be named with a reason**,
not swallowed by a regex.

⭐ **Its scan was wrong twice, in opposite directions.** Anchored on `cp ` it read
only the first source per line and hid `package.json` **in both builders**, which
is symmetric and therefore silently useless. Widened to every `"$REPO/..."` it
swept in build inputs (`tools/macos-floor`, `native-app/main.swift`).
⇒ **"What ships" is a claim about the DESTINATION**, so it keys on `$STAGE/app`.

⭐⭐ **And the stale-reason check made me delete two of my own entries.**
`install/kosmos` and `install/setup.sh` go to `$STAGE/bin`, not `$STAGE/app`, so
they were never app-staging differences. **A reason explaining a difference that
does not exist will mislead somebody.**

📌 The fact worth keeping from that entry moved to the builder's header: **the
Windows package has no update path.** A person updates it by downloading the zip
again. Fine for an unsigned preview, **not fine behind a Download button.**

## What this package honestly is

**The board, and not the agents.** An agent is a tmux pane and there is no tmux,
so the agent surface is dark. The README says so in those words, and
`manifest.json` records `agents_supported: false`.

## 🛑 Not done

**Nobody has run it on Windows.** Every claim is about what the builder stages
and what the launcher says, verified by building the zip and reading its bytes on
a Mac.

The two most likely first-contact failures, named so somebody can check them
first: **the launcher's quoting**, and **whether `APPDATA` is populated in the
environment a double-click inherits**.

Suite 2987 pass, 0 fail. Perturbed six arms.
