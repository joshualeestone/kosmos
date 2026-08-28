# whoamilive-1304: whoami reads the running process first

## Why this branch exists

PigeonPete and I both claimed #1304 within a minute of each other and both shipped. His #1318
added `engine/runningas.js`, which walks a pane's process tree to the claude descendant and
reads the environment it is **actually** running with. Mine added `/api/whoami` and the
`kosmos whoami` verb, deriving the account from the startup file Kosmos wrote and the model
from the transcript.

**Two readers of one fact is the defect this codebase pays for most**, and I argued against it
on the card before either of us knew the other was building. He replied "YES, USE IT", so this
makes them one answer.

## Why the live read wins

His measurement, on this machine: **every agent brief says `claude-fable-5` and all 18 panes
run `claude-opus-5`.** Baron's brief said `josh@stuff.io` after he had been migrated to
`josh@book.io`. Both were correct when written and went stale when the thing they described
moved. **Read live state; do not restate it.**

## The change

`whoamiFor(card, known, live)`:

- prefers `live` when it can see the agent and knows either fact, marking `source: 'process'`
- falls back to the record derivation otherwise, marking `source: 'record'`
- **an empty live reading does not outrank a record that might know**

The tmux session comes from the roster row (`session`, e.g. `angel-discord`) rather than being
rebuilt from the board name (`angel`): a second place that knows that convention is a second
place to get it wrong. A token-resolved **paneless** agent has no session at all, which is
exactly when the live reader cannot answer.

## What must not move

- **Neither source may guess.** `account: null` when neither can tell. This card exists because
  agents gave confident wrong answers.
- **The model must not substitute for the account.** Each field carries its own null.
- **The sender stays derived, never named.** No `agent` parameter, so an agent cannot ask who
  somebody else is.

## Verification

- `whoamiFor` is exported and driven directly: a test needing a real process tree, a tmux
  server and a signed-in account would not run anywhere.
- Three arms: live wins, a live reader that cannot see the agent falls back, and an empty live
  reading does not outrank the record.
- Full suite green. Reverting `server.js` turns the new test red.


## Corrections to this plan, after two blind reviews

⚠️ **The sections above describe the FIRST design and a reviewer flagged that they no longer
match what ships.** Left in place rather than rewritten, because the difference is the useful
part; here is what is actually true.

**`source` is a per-field object, not a string.** It was `'process' | 'record'` for the whole
answer. It is now `{ account, model }`, because the two fields can legitimately come from
different readers and one string cannot say so.

**The precedence is per field, and it is not "live wins".**

```
account   live first, record as fallback   a startup file goes stale after a migration
model     record first, live as fallback   a transcript follows a mid-session /model switch,
                                           a launch command line does not
```

🛑 **The original "prefers live when it can see the agent and knows either fact" was the
defect, not the design.** `live.ok && (live.account || live.model)` returned early, so a live
reading holding ONE fact hard-nulled the other. `agent-supervisor.sh` adds `--model` only when
a model was chosen, so `{ok: true, account, model: null}` is the COMMON shape, and the route
told agents "we cannot tell which model" about agents whose transcript says otherwise.

**Four arms, not three.** account-only, model-only, no-live, and failed-live-that-still-carries-
fields. Then a fifth for the MODEL precedence, and later a sixth for the ACCOUNT precedence:
both sources populated with DIFFERENT values, which is the only shape that can tell "this
source won" from "the other one was empty".

🛑 **The fifth arm pinned the model's rule and I wrote that it pinned "the precedence".** It did
not. Round 2 inverted the ACCOUNT precedence so the record beats the live reading and the whole
suite stayed green - the identical defect, one field over. `acctOnly` runs before the fixture
plist exists and passes `known = []`; `noLive` and `notOk` both pass `ok: false`. **No arm had
both readers populated with different accounts.** ⭐ I applied the lesson to the field it was
found on and did not ask whether its sibling had the same hole.

## What each review actually caught, since that is what a plan is for

**Round 1** found the hard-null blocker above, and that my record arm asserted `'account' in
result` against an ALL-NULL OBJECT - true of a completely broken fallback.

**Round 2** found the sharper one: **the precedence itself was pinned by nothing.** Swapping the
model branches left the whole suite green, because my fixture had no transcript, so `readModel`
returned null in every arm and the two branches were never both populated. ⭐ **I had written
that exact weakness into a comment and left it open** - naming a gap is not closing it.

It also found the live-failure sentence was unreachable, `isDefault` was hardcoded about a
directory that is usually the default, the pre-existing route test was shelling out to the real
machine's tmux and ps, and the sandbox guard covered the write but not the delete.

📌 **One finding deliberately not fixed here and carded as #1366:** three synchronous 5s reads
against the CLI's `curl -m 15` means the live path can consume the client's entire timeout, so
a degraded `tmux` gives no answer rather than the record answer. The timeouts belong to
`runningas` and every caller of it, so shrinking them from this route would be a product change
smuggled into a wiring change.


## Round 3, and two of its findings are about my round-2 fixes

**The account precedence had the identical gap as the model.** Above.

**`isDefaultDir` was the second derivation its own comment said it avoided.** I wrote that it
reused `accounts.configFile`'s rule; it hand-rolled the comparison against bare `os.homedir()`,
while `accounts` resolves HOME as `AGENT_WORKFORCE_HOME || os.homedir()` - the sandbox
convention 28 files here rely on. Measured: with the override set, `accounts` calls the
synthesised directory the default and my copy called it not-the-default, **for exactly the
directory `runningAs` had just synthesised AS the default.**

✅ **The fix for a second derivation is to make the first callable, not to write a third**, so
`isDefaultDir` is now exported from `accounts` and `server.js` asks it.

⚠️ **AND MY FIRST TEST FOR THAT WAS VACUOUS.** I guarded the arm on
`process.env.AGENT_WORKFORCE_HOME`, which this suite never sets, so it was skipped and
reverting the fix left 249/249 green. `accounts` resolves HOME once AT MODULE LOAD, so the
divergence is not observable in this process at all. It is now driven in a CHILD PROCESS with
the variable set before any require, carrying its own control that the two rules genuinely
differ there. Verified: reverting the fix now fails.

**Also:** the seeded transcript leaked into the route test below, which silently reported a
model its stub could not have produced; an unreachable `else` asserted an email only another
test's stub can make; `sentenceForWhoami` took a `source` it no longer reads; and a comment
claimed a sibling test used a pattern it does not.
