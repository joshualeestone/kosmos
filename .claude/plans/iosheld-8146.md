# iosheld-8146

The phone shows no subtask count (card premise corrected on #8146). Its one gap from #8140: the task page's Subtasks
list labels a held subtask "Open". Change: ios/Kosmos/TaskPageLogic.swift status reads Done/Replaced, Built, On hold,
Open, the board's tkPaintSubtasks order (built() leaves held out on both sides). Test: ios/LogicTests/taskpage, the
captured read with subtasks put on hold (open, built, closed arms, and a rebuilt-read control). Reverting the line
turns both held arms red (2 of 116).
