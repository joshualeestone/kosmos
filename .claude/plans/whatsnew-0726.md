# whatsnew-0726: the 0.7.26 "Kosmos has been updated" highlights (cut pinned at 03:00 CDT Wed 10-07)

Four lines, each checked against code on main 10-06 ~15:30; no API-key items (Josh 10-05; Splinter, this afternoon):
| line | from | checked against |
|---|---|---|
| Tasks that repeat (wording Mona's) | #4787 (PR #5389), page control #5396, missed runs #5416 (9ea9f6ccb: "Missed the run due ..." in red via .tsk-repeat.missed on the Tasks row and page; checked after rebasing onto main 18:36) | the task page's "Repeats" row (tk-repeat-row: Never / hour / day / week). Kosmos does NOT run the job (engine/taskrepeat.js): a due run makes the task open work again. The agent is nudged only when idle and only if the Prompter is on (engine/agentnudge.js), so the line promises neither a run nor a reminder: only that it is open work again (review 1, Mona, review 2) |
| Token Usage opens in seconds | #5363 (PR #5370), #5367 (PR #5402) | engine/usage.js skips transcripts not written in the window; measured 6.9 min -> 4 to 6 s on the fleet Mac (85,008 files). "On a long history": a small install was never minutes |
| Org charts with a ChatGPT subscription (MAC only; wording Mona's) | #5346 (PR #5361) | engine/orgchartcodex.js returns WHY_WINDOWS on win32, so tagged platforms ["mac"] |
| A cap for Gemini subscription agents | #4588 ask 3 (PR #5414) | Settings > Automation (s-sec-automation) "Gemini subscription agents at once": No limit by default, 1 to 4. It holds only Kosmos's own automatic sends and counts every Gemini subscription agent on the computer (not per Google account), so the line says "Kosmos sends work to" (review 1) |

To ADD if they merge before the 03:00 pin (Splinter this afternoon; Josh asked for both today): Mona's project Pause / Resume
button (#5391, PR #5395, open) and Renet's "Refresh login" on the login-expiry notice (#5407, no PR yet). The window
holds at most 5: if both merge, the Gemini cap line drops (the least asked-for).

Left out: #5287 (shared-project owner line: federation is off for people, federation_live false), #5145 (a wrong
account name after a switch: a fix, not news), #5275 (invitation copy fallback), #5332 / #5325 / #5401 / #4253 / #5247
(tooling, tests, federation), #5354 (the Kosmos+ sign-in wait in minutes), #5254 (cached PDF pages swept), #5388 (screen-reader fix), #5387 and #5383 (0.7.25 fixes), #5320 part 1 and #5376 / #5372 / #5171 (agent-facing).
tools/whats-new-check.js 0.7.26: mac 4, windows 3. engine/whatsnew.test.js 12/12.
Weakest premise: that a person reads "a ChatGPT subscription" as their ChatGPT Plus/Pro plan; the screen's own word is
"ChatGPT subscription", so the line matches it.
