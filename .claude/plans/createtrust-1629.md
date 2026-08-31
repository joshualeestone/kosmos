# 🔴 #1629, the CREATE half: trust the folder in the account the agent will run under

**Branch:** `createtrust-1629` · **Card:** kosmos#1629 · **Demo-blocking, 2:30pm today**

## The bug, in two lines from one function

```
create.js:2765   trustCodexFolder(workerDir(name), configDir)   <- the CODEX write PASSES it
create.js:2856   trustFolder(workerDir(name))                   <- the CLAUDE write OMITTED it
```

`createAgentInner` computes `configDir` from the chosen account (`acct.isDefault ? null : acct.dir`)
and **puts it in the plist**, so the agent starts under that account's `CLAUDE_CONFIG_DIR`. The Claude
trust write did not receive it, so the entry landed in the **default** account's `.claude.json` while
the agent ran under the **new** one. **Claude Code then asks, on a machine where the answer was
already written to the wrong file.**

⇒ **Josh, this morning:** *"I added a new account and I'm trying to create agents on the new account...
I'm getting hit again with this permissions dialog."* Exactly this path.

⭐ **The asymmetry inside one function is what gave it away** - the codex arm ninety lines up already
did the right thing with the same variable.

## Why the shipped #1629 did not cover it, and that is my gap

I built #1629's **flip** half yesterday (`setAccount`, which passes `configDir` correctly at :768) and
scoped it to the flip. **Creation was never covered**, and `setAccount` is not called during creation
(measured: 0 calls in `createAgentInner`). A build carrying only the flip fix **would not have fixed
him.**

## The fix

```js
trustFolder(workerDir(name), { configDir: provider === 'openai' ? null : configDir })
```

⚠️ **Provider-guarded on purpose.** `configDir` holds a **CODEX_HOME** on the OpenAI path, and this
Claude trust write is not otherwise provider-guarded. Passing it unconditionally would write a Claude
trust entry into a codex home - **a new bug shipped inside the fix for an old one.** OpenAI behaviour
is left exactly as it was.

## What is tested, and what was already tested

**This pins the ARGUMENT, deliberately.** `engine/trust.flip-1629.test.js` already proves the
**effect** - that `trustFolder` with a `configDir` writes into that config, and without one writes into
ours. The only unproven link was whether the create path passes it. ⇒ **This file pins the call, that
file pins the behaviour, and together they are the claim.**

**Negative arm, run:** reverting to the one-argument call fails **2 of 2** with
*"a second argument must be passed, or the account is ignored"*. Restored: 2 pass.

The OpenAI arm asserts the Claude trust write never receives the codex home.

## For whoever cuts the build

🛑 **Verify by CONTENT in the tarball**, not the tag and not the branch: extract the artifact and check
that `create.js`'s trust write carries `configDir`. Three merged-is-not-served failures in two days,
and this fix exists only because the last one bit.
