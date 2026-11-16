# everyoneoff-8569: a post that reached nobody never says "everyone on it has it"

Card: kosmos#8569, item 1 (follow-up from #8566). Item 2 (nits in #8566's unmatchedNote) waits for #8566 to merge, since
that code is not on main yet.

## Problem
When every other member of a room is switched off in the project, engine/messages.js deliverOne returns before setting
an outcome, so `outcomes` is `{}` and the aggregate state is `placed`. Both CLIs read that as "Everyone on it has it
waiting." The post woke no one. The same holds for a room with no other member at all.

## Decision
Both CLIs (install/kosmos and tools/windows/kosmos-cli.js) treat a placed delivery whose `outcomes` is an empty object as
reaching nobody: "Posted to <p>. It woke no one: no other member is switched on in this project, so it is only in the
room." With the board's `because` (a pause), only "Posted to <p>." and the Note, as the quiet case already does. A folded
retry of such a post says the same, never "everyone". No `outcomes` key at all (an older board) keeps the old verdict.
The shell matches `"outcomes":{}` on the raw body: words in a post arrive JSON-escaped, so they cannot spell it (tested).

## Rejected
- Suppressing #8566's note when every recipient is off: the card names the CLI verdict as the false sentence.
- A changed board answer (a new field): both CLIs can already tell from `outcomes`, and an older CLI keeps working.

## Weakest premise
That an empty outcomes object only ever means nobody was delivered to. engine/messages.js sets an outcome for every
member it delivers to, holds or leaves quiet; only a switched-off member (and no member at all) sets none.

## Tests
- tools.windows-kosmos-cli-ambig-4653.test.js and cli.post-ambiguous-4653.test.js: nobody, nobody folded, nobody with a
  because, and controls (no outcomes key keeps the old verdict; the words inside a post are not read as the object).
  Two Windows fixtures that used `outcomes: {}` for a delivered post now name a delivered member.
- Mutants: each CLI's branch removed turns its test red.
