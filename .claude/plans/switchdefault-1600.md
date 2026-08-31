# #1600: switching onto the default OpenAI row writes no home, like creating on it

**Branch:** `switchdefault-1600` · **Card:** kosmos#1600, filed by Angel from #1373's challenge
loop.

## The asymmetry

```
setProvider        (create.js:1088)   openaiAccount ? openaiAccount.dir : null    <- pinned EVERY row
createAgentInner   (create.js:2140)   acct.isDefault ? null : acct.dir
```

An agent **switched** onto the default row had that home pinned into its launch job and stopped
following a later `CODEX_HOME` change; an agent **created** on the same row kept following it.
Two routes to what looks like one state, behaving differently afterwards, with nothing on
screen telling them apart.

## The decision the card asked for

The card says both behaviours are defensible and they should not differ by route. I agree with
the second half. On the first, **this is not a coin flip: the repo has already made this
decision three times and enforced it once.**

```
createAgentInner, OpenAI arm    isDefault ? null : dir
createAgentInner, Claude arm    isDefault ? null : dir
setAccount                      isDefault ? null : dir
setProvider                     the odd one out
```

The Claude path carries a **test** for it, with its reasoning beside it: *"Back to the default
is a real choice, and it removes the key rather than writing the default path"*, because
*"absent has always meant the default account, and a rewrite that started stamping the default
would make every unrelated edit look like an account change."*

⇒ **Aligned rather than chosen.** One rule now holds at all four sites.

⚠️ **Weakest premise, named and written into the code:** that codex's default home is the same
KIND of thing as the default Claude account. It is not identical - `CODEX_HOME` is codex's own
variable and `AGENT_WORKFORCE_CODEX_HOME` can override it - so a requirement that a switched
agent keep the home it had AT SWITCH TIME is a defensible opposite.
**What would change my mind:** that requirement being stated. If it is, the other three sites
are the ones to change; the point is that one rule holds at all four.

## 🛑 The alignment I first shipped was WRONG, and the existing suite caught it

`isDefault` is not the condition. `openaiaccounts` derives "default" from
`codexupdate.defaultHome()`, which honours `AGENT_WORKFORCE_CODEX_HOME` and `CODEX_HOME` -
**the SERVER's environment**. A launchd job does not inherit those, so under an override the
server's default and the agent's default are **different directories**, and omitting the key
would silently send the agent to `~/.codex` instead of the home an operator named.

`engine/create.switch-account-1373.test.js` went red on exactly that, and **it fails alone**,
so it was a real regression rather than contention.

⇒ **The real rule is simpler than "is this the default": OMIT THE KEY ONLY WHEN THE AGENT
WOULD RESOLVE THE SAME HOME ANYWAY.** The agent resolves with no overrides, so that is "this
row is the default AND no override is in force".

📌 Composed from `codexupdate.homeIsNamed()` rather than restating the rule, because #1488 was
precisely a second copy of this derivation disagreeing with the first.

## And fixing only the switch would have re-created the card's own defect

Measured: `createAgentInner`'s OpenAI arm had the **same** override hole. So a switch-only fix
would have made the two routes agree **without** an override and **disagree with one** - this
card's complaint pointing the other way. Both sites now carry the same rule, and the test
drives both routes under an override and compares them.

⚠️ **Not touched:** the Claude arm beside it (`CLAUDE_CONFIG_DIR`). The analogous question
there is #1629's, which I shipped separately tonight, and conflating them would widen this
diff past what it is about.

## The test asserts the invariant, not my side of it

Both routes are driven onto the default row and **compared to each other**. A test that only
checked the switch would stay green if somebody later "fixed" the create path to pin instead -
the same divergence pointing the other way.

A **control** drives a NON-default row and asserts it still carries its home, so the change
cannot go wide and silently stop recording every account.

## What I got wrong on the way

- I asserted `def.dir === fs.realpathSync(home)`. On macOS the sandbox is under `/var`, a
  symlink to `/private/var`, and `list()` reports the unresolved spelling --> resolved on both
  sides.
- My control passed the account as `account:` when `setProvider` reads **`accountDir:`**. It
  silently selected the DEFAULT row, so the control failed with *"a non-default row stopped
  carrying its home"* - **a message that accused the fix of being too wide when the call was
  malformed.**
- Route 2 used `runner: 'codex'` with no `codexBin`; the shape is `provider` + `codexBin` +
  `account`. It was refused with *"we do not know that account on this computer"*, which reads
  like a missing account rather than a bad call.

⇒ **Two of those three failures blamed the subject for a defect in my harness.** That is worth
more than the fix: a red whose message names the product is not evidence the product is wrong.
