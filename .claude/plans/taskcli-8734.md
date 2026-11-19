# taskcli-8734: four Tasks and room CLI defects from feedback 11-19 (kosmos#8734)

## Finished looks like
Each item reproduced on 0.8.10 (or shown not to), fixed, and seen in the served build: task show prints an active wake; task close names the word it refuses; never-run is refused over a record that says the task ran; a person's ask naming only others is not on a reader's room --unanswered list.

## Findings and calls
All four reproduced on 0.8.10 and fixed on branch taskcli-8734 (pushed, in review). Reproduced by running the new tests against the served 0.8.10 files themselves (server.js, engine/tasks.js, bin/kosmos from the downloaded artifact): every new check fails there, passes on the branch.

1. **task show hid an active wake.** Cause: the list the CLIs read (`/api/tasks?project=`) is a cheaper arm than the Tasks screen's and never added the wake's words, so `task show` had no Wake line to print. Fixed on the board, so both CLIs get it.
2. **task close blamed a valid option.** `task close p 5 --not-run --bogus` said "--not-run is not an option". Now it names `--bogus`; a plain extra word gets the general "takes no more words" line and names no option. Mac and Windows.
3. **never-run over a recorded check.** Decided: **refuse**. The board refuses `--not-run` when a check is reported on the task (met or unmet: someone checked the work) or it is marked built, and says to close it without --not-run. Rejected: closing it and saying the check is overridden, because the record would then say both "checked" and "never ran", and a done-count reads from it (#8301). Weakest premise: that an unmet check means the work ran. It could mean "looked, nothing there". If that case matters, narrowing to met checks is a one-line change.
4. **A person's ask to someone else stayed on my unanswered list.** Reproduced: a person's post reaches every member, and `room --unanswered` counted any person's post that reached the reader, even one @-naming only another agent. Decided: such a post is listed only for the agents it names. A whole-room ask, and one naming the reader, are unchanged. This **reverses** #7848 review 7, which kept it on everyone's list until the named agent claimed it. Why: one the named agent answered without claiming stayed forever, and listing it at all invites a second agent to answer for the owner. Weakest premise: that a person never means a named ask for the whole room. If they do, they name everyone or nobody. Two older tests updated to the new rule.

## Status
- [x] reproduced on 0.8.10's own files; fixed; tests (cli.task-8734.test.js, server.roomread-others-8734.test.js)
- [ ] review
- [ ] full validation
- [ ] PR, merge, served
