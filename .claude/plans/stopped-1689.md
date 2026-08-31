# stopped-1689: account removal enumerates only running agents

kosmos#1689. **OpenAI arm only** - `.removed-claude-` does not exist on `origin/main`, so the
Claude rename lives in Angel's unmerged #1659 and inherits this when it lands.

## Reproduced before fixing, because the card's premise was unverified

Angel wrote the card from a code reading and said so: *"If `panelessKeys` includes stopped
agents by some path I did not find, the card is void."*

Constructed a profile with no pane and no live process:

```
stopped-one in ROSTER (safeRoster) : false
stopped-one in KNOWN  (register)   : true
```

⇒ **The premise holds.** `safeRoster()` -> `status.snapshot()` -> `panelessKeys`, which does
`if (liveness.alive(key) !== true) continue;`.

⚠️ **I built the fix before running this, which is the wrong order and Angel told me the right
one.** The reproduction happened to confirm it. Had it not, I would have written a fix for a
defect that did not exist.

## What was actually wrong

**Only the enumeration.** The per-agent check already reads the plist from disk via
`create.readJob`, which is true whether or not the agent runs, and the surrounding
`complete` / `jobMissing` handling already separates "no launch file" from "could not read
it" (Renet's #1447). None of that needed changing and none of it did.

## A defect I introduced and caught by reading the code I was building on

My first version unioned `register.known()` names **raw**. `safeRoster()` filters out agents
the person has **removed**, and a profile file outlives that removal.

⇒ **My union would have resurrected a removed agent into this guard and refused the account
because of one the person had already been told was gone.** That is the "two derivations of
the fleet" habit `safeRoster`'s own comment calls this codebase's worst, arriving from the
side that looks like a fix. The removed-agent filter is now applied to the unioned names, and
a throw while reading it makes the check INCOMPLETE rather than quietly shorter.

## Wording

The refusal said `"<name> is RUNNING on this account"` and the failure said `"we could not
check which agents are running"`. **A stopped agent's plist points at the directory just as
hard**, so the wording encoded the bug's own assumption and would reassure a reader checking
whether the guard was sound. The failure message now says "on this account".

## 🛑 Test coverage, stated plainly

**The route has no test, before or after this change.** `engine/openaiaccounts.test.js` covers
`forgetAccount`, which takes `usedBy` as a parameter and was never the defect; the caller that
builds `usedBy` is untested.

What I have instead: the reproduction above, three sibling suites green **by exit code**
(openaiaccounts 26, remove 55, register 22), and the fix read against the code it changes.

**That is weaker than my usual bar and I am not dressing it up.** The honest follow-up is a
route test on the `server.switch-account-1373.test.js` pattern, which requires an OpenAI
account fixture plus a stopped agent whose plist names it.
