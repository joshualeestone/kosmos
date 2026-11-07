# nudgeheld-8140: #8140 item 1 follow-up (a)

#8143 left a gap it named: the agent nudge carries subtask counts only when a subtask is built, so a parent whose
open subtasks are on hold and none built says nothing about them, and an agent can take up pieces nobody was given.
Change: engine/agentnudge.js carries the counts when any subtask is held too, and says "N of its T subtasks are on
hold; L not finished." with no built arm (so never "mark it built"). The #6421 control (no built, none held: nothing
said) is unchanged. Tests: agentnudge.test.js 48/48 (two new arms), the other ten nudge-reading files 183/183.
Mutations of the subs gate, the text gate and the left clause each turn a test red.
