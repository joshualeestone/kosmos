# everyoneoff-8569: a post that reached nobody never says "everyone on it has it"

Card: kosmos#8569 (follow-up from #8566), both items. Item 1 was built first; #8566 then merged, the branch was rebased
onto it, and item 2 was added.

## Problem
When every other member of a room is switched off in the project, engine/messages.js deliverOne returns before setting
an outcome, so `outcomes` is `{}` and the aggregate state is `placed`. Both CLIs read that as "Everyone on it has it
waiting." The post woke no one. The same holds for a room with no other member at all.

## Decision
Both CLIs (install/kosmos and tools/windows/kosmos-cli.js) treat a placed delivery whose `outcomes` is an empty object as
reaching nobody: "Posted to <p>. It woke no one on this computer: no other member of this project is switched on here
(or none is on this computer). To reach a switched-off member anyway, name them: start with 'YourName -> Their Name:' or @-name them (@all does not reach them)."
(engine/messages.js namedHere: a named member is never in offHere, so naming one does reach it.) With the board's
`because`, only "Posted to <p>." and the Note, as the quiet case does; the engine sends no `because` with an empty
outcomes object today (loopPausedHere is set only for a member that gets an outcome), so that arm is defensive. A folded
retry of such a post says the same, never "everyone". No `outcomes` key at all (an older board) keeps the old verdict.
The shell matches `"outcomes":{}` on the raw body: words in a post arrive JSON-escaped, so they cannot spell it (tested).

## Rejected
- Suppressing #8566's note when every recipient is off: the card names the CLI verdict as the false sentence.
- A changed board answer (a new field): both CLIs can already tell from `outcomes`, and an older CLI keeps working.

## Weakest premise
Scoped to this computer, and no "only in the room" claim: a room shared with another computer sends an agent's post
out through its seat whatever the local outcomes say (server.js sendRoomPostAsAgent, federateOut), so an empty object
says nothing about the far side.
That an empty outcomes object only ever means nobody was delivered to. engine/messages.js sets an outcome for every
member it delivers to, holds or leaves quiet; only a switched-off member (and no member at all) sets none.

## Tests
- tools.windows-kosmos-cli-ambig-4653.test.js and cli.post-ambiguous-4653.test.js: nobody, nobody folded, nobody with a
  because, and controls (no outcomes key keeps the old verdict; the words inside a post are not read as the object).
  Two Windows fixtures that used `outcomes: {}` for a delivered post now name a delivered member.
- Mutants: each CLI's branch removed turns its test red.

## Item 2 (nits in #8566's unmatchedNote)
- `outsiderNamed(word, outside, roster)`: the one lookup for "this word names an agent on this computer who is not on the
  project". outsidersNote speaks of it (when it is a handle kosmos msg takes); unmatchedNote stays silent for it, as before.
  A trailing possessive is read as the name in both, so "Josh's" for an outsider josh gets the kosmos msg pointer.
- A name is said once whatever its case ("Josh & josh"), compared by nameKey.
- A trailing possessive is said as the name ("Josh's" is said as Josh), as mayMean already reads it.
- #8566's test title for a room of the poster alone no longer says the CLI says everyone has it.
- Tests: engine/messages.unmatched-8566.test.js (case, possessive, a two-name control); the outsider sentence still passes
  engine/messages.mention-4642.test.js. Mutants: the old dedupe, and no possessive strip, each turn the test red.
