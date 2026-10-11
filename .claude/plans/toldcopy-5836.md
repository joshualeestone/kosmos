# toldcopy-5836: the task page says "check", and says plainly what you have not been told

Follow-up to #5838 (#5836, Angel), from Mona Lisa's copy note on that PR; it merged with the original words.

## Done when
- A repeating task's line on the page uses "check", not the CLI's "reading", in all four cases of tskToldSentence.
- Never told: "Its latest check found “X”. Kosmos has no record of you being told this." (was "…has not been recorded as told to you.")
- Changed since: "Its latest check found “X”. You were last told “Y” (2 hours ago)." New value first, old second.
- web.task-told-5836.test.js asserts the new words and fails on the old (measured: 4 of 5 fail on origin/main's page; the 5th is the no-field control).
- The mobile-shots task-told-5836 screen's verify regex and its README row match the new words.

## Calls
- Only the PAGE sentences change. The CLI and server lines are written for agents (`kosmos task ran/told`) and keep "reading".
- "check" over "reading": a person never ran `task ran --value`; to them it is the task checking something.
- Rejected: keeping "has changed since you were last told" (it puts the old value at the end, where a person scanning reads last).
- Never-told keeps a hedge on purpose (review 1): Kosmos only knows a person was told when an agent ran `kosmos task told`, so "You have not been told this yet" would be false for someone told in chat. "No record" says where the knowledge stops, in plain words.
- Weakest premise: "check" could be read as a checkbox. In the line it always sits in "its latest check found", which reads as an action.
