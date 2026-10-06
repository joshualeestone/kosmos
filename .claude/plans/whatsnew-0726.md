# whatsnew-0726: the 0.7.26 "Kosmos has been updated" highlights (cut pinned at 03:00 CDT Wed 10-07)

Four lines, each checked against code on main 10-06 ~15:30; no API-key items (Josh 10-05; Splinter 15:33):
| line | from | checked against |
|---|---|---|
| Tasks that repeat | #4787 (PR #5389), page control #5396 | the task page's "Repeats" row (tk-repeat-row: Never / hour / day / week) and the board's sentence "Repeats ... Last run ... Next ..." |
| Token Usage opens in seconds | #5363 (PR #5370), #5367 (PR #5402) | engine/usage.js skips transcripts not written in the window; measured 6.9 min -> 4 to 6 s on the fleet Mac (85,008 files). "On a long history": a small install was never minutes |
| Org charts with a ChatGPT subscription (MAC only) | #5346 (PR #5361) | engine/orgchartcodex.js returns WHY_WINDOWS on win32, so tagged platforms ["mac"] |
| A cap for Gemini subscription agents | #4588 ask 3 (PR #5414) | Settings > Automation (s-sec-automation) "Gemini subscription agents at once": No limit by default, 1 to 4 |

To ADD if they merge before the 03:00 pin (Splinter 15:33, Josh asked for both today): Mona's project Pause / Resume
button (#5391, PR #5395, open) and Renet's "Refresh login" on the login-expiry notice (#5407, no PR yet). The window
holds at most 5: if both merge, the Gemini cap line drops (the least asked-for).

Left out: #5287 (shared-project owner line: federation is off for people, federation_live false), #5145 (a wrong
account name after a switch: a fix, not news), #5275 (invitation copy fallback), #5332 / #5325 / #5401 / #4253 / #5247
(tooling, tests, federation), #5320 part 1 and #5376 / #5372 / #5171 (agent-facing).
tools/whats-new-check.js 0.7.26: mac 4, windows 3. engine/whatsnew.test.js 12/12.
Weakest premise: that a person reads "a ChatGPT subscription" as their ChatGPT Plus/Pro plan; the screen's own word is
"ChatGPT subscription", so the line matches it.
