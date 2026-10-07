# whatsnew-0727: the 0.7.27 "Kosmos has been updated" highlights (cut pinned at 03:00 CDT Wed 10-07)

Drafted from merges since the 0.7.26 pin 2630fd2c1, then topped up with the two that merged later in the evening
(PR #5395 Pause/Resume, PR #5433 model picker). Five lines, the maximum. No API-key items. #5407 Refresh login had
not merged when this was finished.
| line | from | checked against |
|---|---|---|
| Pause a project in one click | #5391 (PR #5395) | a Pause / Resume button beside the name on the project's own page; a paused project shows a line under its name and a "Paused" badge on its card in the Projects list (pjPillOf); Mona Lisa's line, with "beside the name on each project's page" (the button is on the project's page, not the list; she was told) |
| Pick the model when you switch provider | #5429 (PR #5433) | on AI Settings, Runs on, choosing another provider shows that provider's model choice before Switch & Restart, and provider, account and model change in one restart. Only Claude and OpenAI offer a choice (Gemini, Grok and Antigravity pick their own), so the line names those two instead of Mona's "another provider" (she was told) |
| Move a project's folder | #5340 (PR #5423) | project settings (pjs-move-path), shown only when the recorded folder is missing or not a folder: "If you moved this folder, paste where it is now and Kosmos will use it from there." |
| A steadier top bar | #5379 (PR #5426) | the header no longer moves ~15 px when the layout flips between tabs and the consolidated board view where scrollbars take width; the line names the View control's two options, "Separate tabs" and "One screen" (web/index.html ~12000; review 2: "board layouts" is not a name the product uses; review 1: most people stay on Separate tabs, which never jumped) (classic scrollbars: Windows, a Mac set to always show them) |
| Codex agents in their own space (MAC only) | #4592 (PR #4605) | a private Kosmos-owned CODEX_HOME per agent; desktop plugins, hooks and config kept out; bin/agent-supervisor.sh is the Mac supervisor, so tagged ["mac"]; existing agents move at their next supervisor launch, so "From their next start" (review 1); "the plugins and settings of your own Codex app no longer reach them" because desktop config such as an MCP server also stops reaching the agents, a trade-off, not only a gain (loop review 2) |

Left out: #5417 (community status links, agent-facing CLI), #5421 (federation edge case), #4986 (Linux CI).
