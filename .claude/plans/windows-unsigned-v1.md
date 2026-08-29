# An unsigned Windows build, so Josh can see one function

**Card #1112. Josh, 2026-08-29 14:21 CDT: "Let's ship one unsigned to see it
function and then let's walk through the process of what we have to do to buy a
certificate because I'm not familiar with that process at all."**

Shipping unsigned takes the certificate off the critical path. It has a purchase
and validation delay that nothing else removes, and everything except signing can
be built and tested while it clears.

## What this is

`tools/build-kosmos-windows.sh` produces `dist/kosmos-windows-x64.zip`, 35MB:

```
Kosmos/
  app/         server.js, package.json, engine/*.js (136), web/
  runtime/     node.exe (PE32+ for MS Windows), LICENSE
  Kosmos.cmd            launcher
  Install Kosmos.cmd    double-clickable wrapper
  install-kosmos.ps1    the installer
  README.txt
```

## Why a separate script rather than a flag on the Mac builder

The Mac builder compiles Swift, runs `lipo` universal-binary checks, fetches and
builds tmux from source, and constructs a `.app`. **None of that has a Windows
meaning.** A `--windows` flag would thread a condition through all of it to reach
a small subset. This stages the subset directly.

## Deliberate non-goals

- **No agents.** The agent path needs tmux and launchd, and the paneless path is
  inert anyway (#1502). A Windows board says it cannot see anything running,
  which is correct on a fresh machine. The README says so in plain words so the
  person does not read it as a fault.
- **No signing.** Windows will show "Windows protected your PC". The README
  explains More info then Run anyway, because a person who does not know that
  concludes the download is broken.
- **No native window.** That is Swift and arm64-only, tracked separately as #1118.
  A browser satisfies "comes online".

## Verified ON WINDOWS, not inferred

Installed on `kosmos-windows-test` (Windows Server 2022) via SSM, 2026-08-29:

```
installer exit code   0
install dir           True      node.exe present  True
engine modules        136       uninstaller       True
GET /                 HTTP 200, 1,958,636 bytes, <title>Kosmos
GET /api/projects     HTTP 200
GET /api/status       HTTP 500  (expected: no tmux)
store landed at       ...\AppData\Local\AgentWorkforce
```

**Two bugs found by running it rather than by reading it:**

1. **A cosmetic shortcut failure killed the whole install.** Running as
   LocalSystem, `$env:APPDATA`'s Start Menu directory does not exist, so
   `CreateShortcut` threw and `$ErrorActionPreference='Stop'` took the run down
   **after the app had been copied successfully.** The person would have had a
   complete working install and an error message. Shortcuts now create their
   parent and never fail the run.
2. **The PowerShell had never been parsed.** It parses clean on PS 5.1, verified
   with a control (a deliberately broken script returns 4 errors).

**And the defect this whole line of work exists for, found sitting on that disk:**

```
C:\Windows\system32\config\systemprofile\Library\Application Support\AgentWorkforce\bin\agent-supervisor.sh
```

Created 2026-08-25 by an earlier install. **A literal Mac path, on Windows,
holding our files, and nothing threw.**

## The guard that matters

**Building from a tree without the platform-aware data root produces a bundle
that installs cleanly and then writes its store to a literal
`Library/Application Support` folder Windows does not know about. Nothing about
the install looks wrong.** I know because the first bundle I built did exactly
that, and only a control on the extracted artifact caught it.

So the build refuses. Both arms measured:

| arm | result |
|---|---|
| staged from a tree WITHOUT the fix | **refuses**, names both files, says which branch to land |
| staged from a tree WITH the fix | passes, produces the zip, exit 0 |

⚠️ **THE GUARD ASSERTS THE POSITIVE, AND ITS FIRST TWO VERSIONS DID NOT.**

An absence-based check (`Library ... Application Support` must not appear)
**refuses a CORRECT tree**: `store.js`'s own `dataRootFor` contains that string
three times, in its darwin branch and its docblock, entirely legitimately.
Measured.

Its replacement then **built from a tree whose resolver had been renamed away**,
because `grep "function dataRootFor"` matches `function dataRootForRenamed(` as
a substring. It now asserts `ROOT = dataRootFor(` and `store.dataRootFor(`,
which is the wiring that must actually be true.

| arm | result |
|---|---|
| correct tree | BUILDS |
| `create.js` reverted to the literal | REFUSED |
| reverted with the one-segment re-spelling | REFUSED |
| `store.js` resolver renamed away | REFUSED |

## Dependency

**Requires `data-root-platform`.** Merged into this branch rather than assumed,
and the guard above enforces it rather than trusting it.

## Verified

```
build exit 0, 136 engine modules staged
node runtime sha256 MATCHES nodejs.org SHASUMS256.txt
node.exe                     PE32+ executable (console) x86-64, for MS Windows
archive                      156 files, 35MB
shipped engine/store.js      appDataHome 2, 'Application Support' 0
                             CONTROL 'const ROOT' 1, so the grep reads the file
shipped platformpaths.js     present
```

## Not verified, and I am not claiming it

**Nothing here has run on Windows.** The installer, the shortcuts, the Startup
entry and the launcher are unexecuted. The next step is the existing
`kosmos-windows-test` box, which already carries an SSM instance profile and can
therefore be driven with PowerShell automatically. That box is Baron's and billed,
so starting it gets announced.
