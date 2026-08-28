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
