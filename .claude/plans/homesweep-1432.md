# #1432: the frozen-HOME sweep, seven modules in one PR

## Why one PR

Mona Lisa's call, reviewing `accthome-1419`: *"this class is quietly being fixed ONE FILE AT A TIME by different people who do not know about each other. That argues for one sweep card rather than a third one-off."* Three people had already fixed three files without knowing about each other (`runningas.js`, `openaiaccounts.js` in #1420, `accounts.js` in #1433).

## The class

A module-level `const` reaching `os.homedir()` freezes at **require time**. A caller that sets the sandbox seam *after* requiring the module reads straight past it and operates on the operator's real machine, while believing it is sandboxed.

Two measured instances of what that costs:
- `accounts.list()` returned **four of the operator's real accounts** against an empty fixture (#1419).
- `delete-leftover`'s `TRASH()` resolved to **`/Users/agent1/.Trash`**, and that module renames files into it.

## The seven

| module | const | uses |
|---|---|---|
| `create.js` | HOME | 9 |
| `delete-leftover.js` | HOME | 2 |
| `instructions.js` | ROOT | 4 |
| `runners.js` | HOME | 7 |
| `status.js` | HOME | 9 |
| `subscription.js` | HOME | 2 |
| `trust.js` | HOME | 2 |

Each becomes a function called at its sites. Two modules needed a shape decision:

- **`instructions.js` exports `ROOT`.** Kept as a **lazy getter** so the export cannot re-freeze what the function unfroze.
- **`runners.js` already had a `homeDir()`** that was lazy about the env var and fell back to the frozen const. **Half a lazy resolver reads as a whole one.** The existing function now reaches `os.homedir()` directly; no second function was added.

## 🛑 The mechanical sweep was wrong twice, and both were caught by tests rather than by review

A blind identifier rewrite cannot tell a declaration from an export from prose.

1. **`instructions.js` stopped parsing.** `module.exports = { ROOT, FILENAME, ... }` became `{ rootDir(), FILENAME, ... }`, a syntax error. It also rewrote **two comments** that merely mentioned `ROOT`.
2. **`runners.js` recursed infinitely.** It already had a `homeDir()`; my rename collided with it, so `homeDir()` called itself and the suite reported `Maximum call stack size exceeded`.

⭐ Neither is subtle once seen, and neither was visible from the sweep's own output: the script reported `left: 0` for both, which was true and meaningless. **A rewrite that reports how many references it changed is not reporting whether the file still means the same thing.**

## Verification

**All seven files, single-file: 427 tests, 0 failures.**

**Behavioural, both arms, where the resolution is observable from outside:**

```
delete-leftover  TRASH()  seam set AFTER require   -> FOLLOWS the sandbox
                          pre-fix, same probe      -> /Users/agent1/.Trash   (defect reproduced)

instructions     ROOT     seam set AFTER require   -> FOLLOWS the sandbox
                          pre-fix, same probe      -> /Users/agent1/work/workers  (defect reproduced)
```

📌 My first `instructions` probe reported FROZEN and was **wrong**: it set `AGENT_WORKFORCE_HOME` while that module keys on `AGENT_WORKFORCE_WORKERS`. The probe was aimed at a neighbouring seam. Re-run against its own seam, both arms are clean. Worth recording because "the fix did not work" and "my probe used the wrong variable" produce the same red.

**Source-level, all seven:** zero module-level frozen consts reaching `os.homedir()` remain.

## What I did NOT verify, and it is most of the modules

`create.js`, `status.js`, `runners.js`, `subscription.js` and `trust.js` **do not expose their home resolution**, so I have **no behavioural arm for them** - only their tests passing and the source check. That is weaker evidence than the two above, and I am not going to imply otherwise: their conversion is verified as *not breaking anything*, not as *fixing the freeze*.

Anyone reviewing should aim there first. A per-module observable seam would be the honest way to close it, and I did not add one.

**No full suite: 0.6.05 is cutting and the machine is Baron's.** This should not merge until a suite has run on it.

---

## Round 2: the first version of this sweep did NOT fix the two biggest modules

I published this PR claiming *"zero module-level frozen consts reaching `os.homedir()` remain"*. **True, worthless, and it hid two live defects.**

### What the source check could not see

The fix moved `os.homedir()` behind `homeDir()`. My check keyed on `os.homedir()` **inside a const**, so a const that called the new lazy function was invisible to it:

```js
create.js   const WORKERS_DIR = ... path.join(homeDir(), 'work', 'workers');   // frozen at load
create.js   const AGENTS_DIR  = ... path.join(homeDir(), 'Library', ...);      // frozen at load
status.js   const WORKERS_DIR = ... path.join(homeDir(), 'work', 'workers');   // frozen at load
```

⇒ **The freeze did not go away; it moved up one level of indirection**, and the instrument that was supposed to detect it keyed on the exact thing the fix relocated. Measured: `create.workerDir('probe')` still returned the real machine with the seam set after require.

### And the second-round check missed two more, for a different reason

A line-based scan cannot see a declaration that spans lines:

```js
create.js:199        const SUPPORT_DIR = ...        3 lines
subscription.js:51   const CONFIG = ...             2 lines
```

Both reached `homeDir()` on a continuation line. **Two instruments, two different blind spots, same defect class.**

### Exports re-freeze too

`subscription.js` exported `CONFIG_PATH: configFile()`, evaluated at module load. A lazy getter was needed there exactly as in `instructions.js`. Swept for the pattern afterwards; no others.

### 🛑 And a behaviour change a comment had explicitly warned against

`runners.js` documented that `managedRoot()` keys on the **bare module `HOME`, NOT `homeDir()`**, deliberately, because that path *"has its own sandbox seam and adding a second one here would give one directory two ways to be redirected."*

My rename made it `homeDir()`, so it began honouring `AGENT_WORKFORCE_HOME` - **the exact thing the comment says was avoided on purpose.** Restored to `os.homedir()` directly, comment repaired. The unfreezing was the bug; the env-awareness distinction was not.

⭐ The comment was correct, present, and I drove through it. That is the unheeded-comment class, and a mechanical rewrite is the ideal vehicle for it.

## Verification, round 2: every module against ITS OWN seam

```
                          POST-FIX    origin/main
create.workerDir          follows     FROZEN
create.plistPath          follows     FROZEN
subscription.CONFIG_PATH  follows     FROZEN
instructions.ROOT         follows     FROZEN
delete-leftover.TRASH     follows     follows      <- its own seam always worked
runners.homeDir           follows     follows      <- already lazy for this var
```

📌 The last two rows are the control doing its job: they show the probe can come back "follows" on main, so the four FROZEN rows are not an artifact of the harness. `delete-leftover`'s freeze was in its **HOME fallback**, proved separately (pre-fix `TRASH()` resolved to `/Users/agent1/.Trash`).

📌 I aimed a probe at the wrong environment variable **twice** while doing this - `AGENT_WORKFORCE_HOME` at modules keyed on `AGENT_WORKFORCE_WORKERS`. Both times it reported FROZEN and both times the code was fine. **"The fix did not work" and "my probe used the wrong variable" produce an identical red.**

## Still unverified, and stated as unverified rather than argued away

**`status.js` and `trust.js` expose no path resolution**, so they have **no behavioural arm**. Their conversion is verified as not breaking anything (141 and 29 tests) and by source inspection. That is not evidence that the freeze is gone for them.

All seven files: **427 tests, 0 failures.**
