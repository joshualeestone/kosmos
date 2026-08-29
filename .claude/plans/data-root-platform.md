# create.js still spells out the macOS data root, and #570 did not touch it

**Card #570 / #1112.** #570 landed at 14:31 today and made `store.js`'s data root
platform-aware. **It did not touch `create.js:206`**, which still built
`~/Library/Application Support/AgentWorkforce` by hand.

So the product had **two answers** to "where does this product keep its files"
and only one of them knew what Windows is.

## What this does

`create.js`'s `supportDir()` now calls `store.dataRootFor(process.platform,
homeDir(), process.env)`. **Two JavaScript callers, one resolver.**

🛑 **NOT "no second spelling" ANYWHERE, WHICH IS WHAT THIS SAID AND IT WAS AN
OVERCLAIM.** Still in the tree and NOT fixed here:

- **`install/setup.sh:822, 824, 1176, 1364`** hand-build
  `${AGENT_WORKFORCE_DATA:-$HOME/Library/Application Support}/AgentWorkforce`.
  It is shell, so it *cannot* call `dataRootFor`. ⚠️ **And it is the
  UNINSTALLER, which is the code that DELETES**, so a third answer lives in the
  one place where being wrong destroys something. A Windows installer needs its
  own answer and that is tracked with the packaging work.
- **`engine/commitments.js:52`** reads `AGENT_WORKFORCE_DATA` without the
  `AgentWorkforce` segment. Pre-existing, documented in its own comment, and
  noted only because the sentence above used to claim otherwise.

**It does NOT add a competing implementation.** I had written one
(`engine/platformpaths.js`) before #570 merged, and deleted it. Two agents solved
one card in parallel; the right resolution is one function, and #570's is on main
and is well-built. **Converging on it is worth more than defending mine**, and it
has the property that matters: whatever gets decided about Roaming versus Local
now applies to both call sites automatically, because there is only one place
that decides.

## Why `homeDir()` is still passed rather than letting store resolve it

`create.js` reaches home through a lazy `homeDir()` because as a const it froze
at require time and resolved to the operator's real machine with the test seam
set (#1432). `dataRootFor` taking home as a parameter is exactly what lets this
caller keep its own resolution. Pinned by a child-process test.

## The guard, and why it asserts the POSITIVE

An earlier version searched for the literal string. **Measured, four plausible
re-spellings defeated it, all green**, each resolving correctly on a Mac and
breaking Windows: a line-wrapped `path.join(`, column-aligned quotes, a hoisted
`const LIB_DIR`, and `'Application' + ' Support'`. It also went **red on a doc
sentence** mentioning the folder, which is a false accusation.

🛑 **AND THE REPLACEMENT WAS ALSO WRONG, IN BOTH DIRECTIONS.** I wrote "no
re-spelling fakes it"; a reviewer measured **three fakes** in minutes -- a
COMMENT naming `store.dataRootFor(`, a dead `if (false) return ...`, and a
mention 150KB away in an unrelated function -- because the regex scanned the
whole file rather than the function. **And it accused correct code**:
`const { dataRootFor } = store` and `s.dataRootFor(...)` are real delegation and
both went red.

✅ **The guard is now scoped to `supportDir`'s BODY with comments stripped**, a
loose positive arm (`\bdataRootFor\s*\(`, so aliasing is not accused) and a
negative arm on that body only. Third version. **Every previous one was a
whole-file text search, and that was the mistake each time.**

## Verified

| arm | result |
|---|---|
| unmodified | GREEN |
| `create.js` reverted to the literal | RED |
| reverted with the ONE-SEGMENT spelling that beat the old guard | RED |
| `supportDir` export removed | RED |
| the frozen-able `SUPPORT_DIR` name comes back | RED |

```
full suite            2987 pass, 0 fail, exit 0
check-frozen-roots    rc 0, engine/store.js:ROOT still tracked
store.ROOT == create.supportDir()   true
seam set AFTER require              honoured
```

## Measured on real Windows, which is why this is not theoretical

On `kosmos-windows-test` (Windows Server 2022), 2026-08-29, there is a folder
created on 08-25 by an earlier install:

```
C:\Windows\system32\config\systemprofile\Library\Application Support\AgentWorkforce\bin\agent-supervisor.sh
```

**A literal Mac path, created on Windows, holding our files.** Nothing threw.
That is the defect #570 describes, sitting on a disk.

## Raised separately, not fixed here

Two things about #570's implementation that are its author's call, not mine:

1. **`path.join` is ambient**, so off Windows `dataRootFor('win32', ...)` returns
   posix separators. Its runtime on Windows is correct, but its TESTS assert a
   value Windows never produces, with substring matchers that cannot see it.
2. **Roaming versus Local.** #570 chose Roaming. The store holds
   `bin/agent-supervisor.sh` and `bin/codex-report-bridge.js`, executables
   written for one machine.

Both on the card.
