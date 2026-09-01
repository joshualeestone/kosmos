# reply-doctrine-operator: an agent that is messaged answers in its own pane, and greets the wrong person

kosmos#1673 (it does not know HOW to answer) and kosmos#1676 (it does not know WHO it is answering).

## Problem

Josh, creating demo agents on 2026-08-31: they receive his message, answer conversationally in their own pane, and never run a command. He watches an empty dialog. Where an agent has a `reportsTo`, it also greets that manager rather than him.

Two independent reasons, both established from the code rather than inferred:

**1. The standing text named commands that cannot reach him.** `### Answering where you were asked` told an agent to use `kosmos post <project>` for a room and `kosmos msg <name>` "for one person". `install/kosmos:512` states outright that `post` reaches a room and `msg` types into another agent's terminal, and that **neither reaches the person who messaged you**. The only command that does is `kosmos reply`, and it appeared solely in the bracketed prefix on the message itself.

⇒ An agent that consulted its instructions and obeyed them still could not answer.

**2. The agent had exactly one human's name, and it was the wrong one.** `engine/reports.js blockBody()` splices `## Who you report to` into the instructions. In the managed branch it names the manager and says a question for a person "goes to them first". `personName()` is called **only in the else branch**, so a managed agent never learns the operator's name at all. Greeting the manager is the obedient reading.

## Change

**A. `engine/defaults.js`: a NEW section `### Answering the person who messaged you`.**

New heading on purpose. `missingFrom()` matches by heading, so an edit inside the existing section would reach only future agents and heal none of the ones already built. It names `kosmos reply`, states that `post` and `msg` cannot reach the operator, and says to answer whoever sent the message rather than whoever you report to.

`DOCTRINE_VERSION` 6 to 7, with the pairing guard's full ceremony: version bumped, log entry added, fingerprint pinned (`92cbc9e7da9b313b`).

**B. `engine/reports.js`: the managed branch names the operator and separates escalation from conversation.**

This is the half that reaches the agents Josh has already built: the block regenerates through `spliceBlock`, and `syncEveryone()` (`reports.js:177`, called from `server.js:5537`) rewrites it for every agent with `isNamedOurs === true`. The defaults section cannot do that; it waits on a consented refresh.

A `personLine()` helper keeps the sentence correct in both states, because `personName()` falls back to a generic phrase and naming it inline produced "run by the person who runs this computer".

## Deliberately NOT changed

**The project-room case.** kosmos#186: answering a room with `kosmos reply` is the wrong surface on purpose. The existing room section is untouched, including its imprecise "for one person" clause. I edited that clause first and reverted it: it broke a test that pins the string, and correcting it inside an existing heading reaches nobody who needs it while risking exactly the room confusion #186 warns about.

## Verification

- **The delivery property, planted rather than assumed.** An instruction file holding every heading except the new one is offered exactly 1 section, the new one. Controls: a complete file is offered 0, an empty file is offered all 13.
- **Both phrasing arms of `personLine()`** measured: with no operator name recorded, and with one.
- **The pairing guard did its job**: my first attempt went red because the block text moved without the fingerprint. That is the guard working, and the ceremony is now complete.
- **Full suite via the repo's own runner** (`bash tools/run-tests.sh`): 3,254 tests, 3,254 pass, 0 fail, exit 0.

## Weakest premise, named

**This is standing prose against a behaviour, and prose already lost here once.** It removes two independent reasons the reply cannot happen; it is not proof the model will now run the command. Capturing the answer without opt-in would be strictly better and is not this change.

I also could not test on a live agent: Josh's agents are not on this box.
