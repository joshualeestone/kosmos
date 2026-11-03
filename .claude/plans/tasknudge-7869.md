# tasknudge-7869: no give after built; a plain answer for reacting to a direct note (kosmos#7869)

## Item 1: a task given (and nudged) after it was built

**What I measured on main.** The two automatic senders already leave a built task alone: the Assigner refuses one
(`tasks.assignPart`, `onlyIfFree && t.builtAt`, #3951) and the Prompter's agent nudge skips a built task the agent marked
(`engine/agentnudge.js`). The one path that gives a built task's part is a deliberate one, a person on the screen or an
agent (`via: 'process'`), and by #3951's rule that give drops the built mark ("an open part given to somebody is work to
do") and records `unbuilt: new work`. After that the task is open again, so the nudges about it are correct, which reads
to the agent as "assigned and nudged after I built it".

**The call.** An agent's give (or take) of an open part on a built task is refused, with a sentence that says it is built
and how to add new work under it (`kosmos task add <project> 'what is left' --parent N`, single quotes because the Mac CLI reads the answer with
sed, which stops at a double quote; it already reopens a built
task with its own record). The person's give from the screen is unchanged: it still reopens the task, as #3951 decided.
Taking an agent OFF a part is not new work and is unchanged.

**Rejected.** Refusing every give on a built task, the screen's included: it overturns #3951's decision for the person,
who gives work deliberately. Re-checking the task just before the line is typed: the delivery queue holds a line only
seconds behind the previous one to the same agent, so it cannot explain a nudge that keeps firing daily.

**Weakest premise.** That the reported nudge came from an agent giving a built task. The original feedback report is not
on this Mac (the card paraphrases it), and "the daily line" could be something outside Kosmos (a fleet's own clock). If
it was, this change is still right but does not close the report.

## Item 2: reacting to a colleague's direct note

`messages.react` answered "there is no post by that id in this room" for a direct note's id, which has the same shape as
a post id. Now, to the two agents the note is between, it says the id is a direct message, that only room posts take a
reaction, and to answer with `kosmos msg <name>`. To anyone else it stays "no post by that id", so a private note is
never shown to exist.

## Tests
`engine/builtgive-react-7869.test.js`, with controls for the screen give, taking off, an unbuilt give, a real room post,
an outsider and a note that did reach its recipient. Both sentences carry no double quote (the Mac CLI reads the
answer with sed, which stops at the first one), and a test pins it. Mutants run on every fix each fail a test.
