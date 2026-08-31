# #1629: an account flip writes trust into the config the agent will actually read

**Branch:** `trustflip-1629` · **Card:** kosmos#1629.

## The defect

Claude Code records workspace trust **per config dir**, reading
`$CLAUDE_CONFIG_DIR/.claude.json` when that variable is set. #164/#165 pre-record the flag at
**create** time into the config *this process* reads. So pointing an agent at another account
left it reading a file where the flag had never been written, and it came up frozen on
*"Is this a project you created or one you trust?"* with **`No, exit` preselected**.

From outside that is indistinguishable from an agent ignoring you: the session is alive and
the process is running. **And the pre-selected answer deletes the agent**, which is the reflex
key.

## What I corrected in the card, and what survived

⚠️ **The card's live instance is contested by its own subject.** It attributes Splinter's seven
unresponsive minutes to this prompt; Splinter says, first-hand, that he was never prompted and
that his replies were going to his terminal instead of Discord. **Different cause, same
symptom.** I am not citing it, and the card's evidence base does not need it.

✅ **The mechanism I measured myself, and it is not what the card says either.** The card
reports the account configs as `false`. Across the key that actually matters - the agent's
**worker folder** - the state is mixed:

```
key                                      ~/.claude.json   account-b       account-c
/Users/agent1                            True             False           False
/Users/agent1/work/workers/pigeonpete    False            True            False
/Users/agent1/work/workers/claudebot     ENTRY-ABSENT     ENTRY-ABSENT    ENTRY-ABSENT
control '/zzz/nope'                      absent           absent          absent
```

⇒ **The entry is often ABSENT rather than false**, so a fix that flipped an existing boolean
would do nothing for the agent that needs it most. Both cells are implemented and tested.

📌 One row is operationally load-bearing and Splinter confirmed the consequence: **claudebot's
worker folder has no entry in any config**, so a restart of the agent that runs fleet alerting
lands on the prompt.

## The change

1. **`engine/trust.js` resolves the config the way Claude Code does.** `CONFIG(dir)` takes an
   explicit account directory; absent, it falls back to `AGENT_WORKFORCE_CLAUDE_CONFIG`, then
   **`CLAUDE_CONFIG_DIR`**, then `~/.claude.json`. The explicit argument wins over the
   environment, because a caller pointing an agent somewhere is not describing its own account.
2. **`setAccount` writes trust at flip time**, into the target account, which is the moment the
   new config dir becomes real and the moment we did nothing.
3. **`install/setup.sh`'s uninstall notice** checked `$HOME/.claude.json` alone and *named that
   file in its sentence*. It now checks every config an agent could read and names the ones it
   found.

**Best-effort and non-gating, deliberately:** the plist is already written when the trust write
runs, so the flip HAS happened. Refusing there would report failure for a change that took
effect. The outcome is **returned** in the result rather than swallowed, which #164's own
comment records as a gap ("nothing on the machine says which guard fired").

## Not done

**Point 3 of the card - surfacing a blocked agent in Kosmos - is not in this branch.** It is a
real and separate piece of work, and Splinter's correction is evidence it is *wider* than trust
prompts: "agent appears unresponsive" has at least two distinct causes and the operator cannot
tell them apart. Half-doing it here would make it look handled.

**Weakest premise, named:** I cannot drive a real launchd flip and watch an agent take a turn,
which is the card's acceptance wording. I assert the state that decides it - the entry in the
target account's config - and prove both the create and flip cells behaviourally.
**What would change my mind:** a flipped agent that still meets the prompt with the entry
present, which would mean Claude Code reads trust from somewhere else again.
