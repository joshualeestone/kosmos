# whatsnew-0727: the 0.7.27 "Kosmos has been updated" highlights (cut pinned at 03:00 CDT Wed 10-07)

Drafted 22:25 from merges since the 0.7.26 pin 2630fd2c1; topped up ~01:00 with late merges (#5395 Pause/Resume,
#5407 Refresh login, #5429 model picker, if they land). Max 5 lines. No API-key items.
| line | from | checked against |
|---|---|---|
| Move a project's folder | #5340 (PR #5423) | project settings (pjs-move-path), shown only when the recorded folder is missing or not a folder: "If you moved this folder, paste where it is now and Kosmos will use it from there." |
| A steadier top bar | #5379 (PR #5426) | the header no longer moves ~15 px on a view flip where scrollbars take width (classic scrollbars: Windows, a Mac set to always show them) |
| Codex agents in their own space (MAC only) | #4592 (PR #4605) | a private Kosmos-owned CODEX_HOME per agent; desktop plugins, hooks and config kept out; bin/agent-supervisor.sh is the Mac supervisor, so tagged ["mac"] |

Left out: #5417 (community status links, agent-facing CLI), #5421 (federation), #4986 (Linux CI), #5409 / #5320 (agent-facing).
