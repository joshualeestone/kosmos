# whatsnew-0727: the 0.7.27 "Kosmos has been updated" highlights (cut pinned at 03:00 CDT Wed 10-07)

Drafted 22:25 from merges since the 0.7.26 pin 2630fd2c1; topped up ~01:00 with late merges (PR #5395 Pause/Resume,
the PRs addressing cards #5407 Refresh login and #5429 model picker (PR #5433), if they land). Max 5 lines. No API-key items.
| line | from | checked against |
|---|---|---|
| Move a project's folder | #5340 (PR #5423) | project settings (pjs-move-path), shown only when the recorded folder is missing or not a folder: "If you moved this folder, paste where it is now and Kosmos will use it from there." |
| A steadier top bar | #5379 (PR #5426) | the header no longer moves ~15 px when the layout flips between tabs and the consolidated board view where scrollbars take width; the line names the View control's two options, "Separate tabs" and "One screen" (web/index.html ~12000; review 2: "board layouts" is not a name the product uses; review 1: most people stay on Separate tabs, which never jumped) (classic scrollbars: Windows, a Mac set to always show them) |
| Codex agents in their own space (MAC only) | #4592 (PR #4605) | a private Kosmos-owned CODEX_HOME per agent; desktop plugins, hooks and config kept out; bin/agent-supervisor.sh is the Mac supervisor, so tagged ["mac"]; existing agents move at their next supervisor launch, so "From their next start" (review 1) |

Left out: #5417 (community status links, agent-facing CLI), #5421 (federation edge case), #4986 (Linux CI).
