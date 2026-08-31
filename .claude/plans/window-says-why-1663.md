# window-says-why-1663: the page says the cause is unknowable, next to the tab holding it

kosmos#1663.

## Problem

Josh's agent detail page, 2026-08-31, while he could not create agents:

> "This agent is not running: nothing on this computer has a session for it. It starts itself when this computer is on and it is not removed; **if it stays off, this computer is not saying why.**"

**One tab over, at the same moment and in the same screenshot, the Terminal tab rendered the answer**: Claude Code's workspace-trust prompt, with `No, exit` pre-selected. The page told him the cause was unobtainable while the product was displaying it.

He stopped looking, spent an hour, and wiped his Mac.

## Why this is worse than saying nothing

**It is not a missing message, it is an anti-message.** Silence invites a search. A confident statement that no explanation exists ends one. It is the same family as the day's other three (a guard wired to nothing, a check that cannot fail, an artifact nothing reads) and the most direct of them: the other three quietly fail to inform, this one actively tells the reader not to look.

## Diagnosis: two reads, never reconciled

The sentence and the window come from different places and nothing compares them.

- **`server.js:1567`** filters the roster for agents no session was seen for, and builds those rows with `target: null, session: null` under the comment *"there is no pane to type into, no session to capture"*. The sentence at `:1676` is written from inside that assertion.
- **`server.js:5347`**, `/api/agent/:name/window`, does its **own** `safeRoster()` plus `chat.viewport()`. Its own comment: *"every request is a roster read plus a capture-pane."*

⇒ Read A says there is nothing to capture; read B captured it. This file already names the hazard at `web/index.html:17151`: *"A card and its detail page disagreeing about an agent's state is worse than either being wrong."* Here it is one page disagreeing with itself.

## Change

One clause, `server.js:1676`:

```
- '; if it stays off, this computer is not saying why'
+ '; if it stays off, its Terminal tab is where to look'
```

**It keeps #671's intent and drops its false half.** That clause exists so a person is not told nothing, which is right and is preserved. What it must not do is assert that no explanation exists, because the product often has one and shows it one tab away.

**It points without promising.** "Where to look" is true whether or not the pane has content: it is the correct place either way. Naming what the tab *shows* would over-promise, since a genuinely sessionless agent renders "We could not read its window just now."

## Rejected alternatives, and why

- **A client-side amendment** when the window paints. Rejected on measurement: `web/index.html:12298` fetches the window **only while the Terminal section is visible**, and Josh read this on the *Talk to* tab. It would have amended the sentence only for someone already looking at the answer.
- **A server-side pane read at sentence-build time**, so the sentence could name the actual reason. Deferred, not rejected: `engine/status.js` already carries `capture-pane`, so it is possible, but it adds a capture to a status path on every row and the honest pointer fixes the reported harm without it.
- **Reconciling the two reads.** The real structural fix and much larger than this card. Worth its own card if anybody wants it.

## Verification

**Two directions, and the perturbation asserted it applied before its result counted:**

```
with the fix                      4 tests, 4 pass, 0 fail
server.js reverted, test kept     4 tests, 3 pass, 1 FAIL      <- the guard fires
restored                          4 tests, 4 pass, 0 fail
```

**The test asserts the PROPERTY, not a new exact string**: the sentence must still send the person somewhere, and must no longer claim the cause is unknowable. Re-pinning a fresh literal would re-arm the same trap for the next person, which is how the original assertion became a hazard.

Full suite through the repo's own runner: **3,254 tests, 3,254 pass, 0 fail**, exit 0.

## Weakest premise, named

**I did not reproduce the state myself.** Josh's agents are not on this box. The contradiction is established from a single screenshot containing both regions, plus the code paths above, not from a live repro. That is strong enough for a copy fix that cannot make anything worse, and it is not strong enough to claim the underlying two-read skew is understood.
