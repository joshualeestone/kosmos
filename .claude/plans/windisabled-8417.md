# windisabled-8417: Windows shows a switched-off agent as switched off

Addresses #8417. Found in #8410's review 3 (Ice Cream Kitty), the sibling of #8410's runningJobs fix.

## Done when
1. `create.disabledJobsResult(undefined, 'win32')` names the agents whose Scheduled Task is switched off, `{ ok: false }` when the Kosmos folder could not be listed, and never asks launchctl.
2. A task switched off by hand in Task Scheduler shows at the next poll, at the cost of one more folder query per poll (register.survey's `list` makes its own).
3. The offline row's sentence on Windows names Task Scheduler and the task, not System Settings.

## Decided
- **Source of truth: the task's own `<Settings><Enabled>`**, read by `win32job.taskEnabled`. Rejected: the CSV Status word as the answer (localized, so a German Windows would never say switched off), and reading the switch through `cachedTaskSpec` (round 1: `taskSpec` gives up on an unreadable argument line, an accented user folder among the ways, and throws away a readable switch; and a `known:false` answer is never cached, so it would spawn every poll).
- **Freshness from the Status word, compared and never interpreted.** `win32job.switchedOffNames` keeps each task's switch beside the Status word it was read under (`SWITCH_SEEN`) and reads it again only when the word changes or the task is new to this process. A failed read is kept too (as unknown) so it is not retried every poll; it is retried when the word moves. The map is rebuilt each call, so a task that left the folder and came back is read again. Cost: one folder query per poll, plus one definition read per agent at board start and per Status change.
- **`folderRows`** is the one CSV parse `list` and `switchedOffNames` share (one parse, two spawns per poll; sharing the spawn would need a per-poll memo, not worth it here).
- **Could-not-look stays distinct:** a failed folder listing is `{ ok: false }`; an empty folder ("cannot find") is a real empty set. One task whose definition could not be read (or whose switch is neither true nor false) is left out of the set: this feeds a sentence, and an unread task is not said to be off.
- **The injected `runner` is ignored on win32.** It is a launchctl runner (machine.agentAutostartCheck), and every caller that passes one is darwin-only; worldstarts excludes win32 before asking. So this arm reaches only the board's display path (server.js jobSwitchedOff and switchedOffSentence).
- **Sentence:** "this agent is not running because its background job was switched off in Task Scheduler. Open Task Scheduler, find agent-<name> in the Kosmos folder and choose Enable, and it can start again". The task name comes from `win32job.taskName`, so a named Kosmos says `agent-<name>+<world>`. No full stop, as the Mac and Linux sentences.
- **Overlap with #8410 (winroster-8410, open):** it edits `runningJobs` just below; this edits `disabledJobsResult` and `switchedOffSentence`. Separate hunks; rebase on whichever lands first.

## Weakest premise
That the Status word changes whenever the switch does. Measured nowhere on a real Windows: it is read from Microsoft's documented Status values (Ready, Running, Disabled, Queued). If a task could be switched off while its Status word stays the same (say it reads Running while its process is still up after a disable), the cached definition would say on until the word next moves. What would change my mind: a real Windows box where `/Change /DISABLE` on a running agent task leaves Status at Running. Then the fix is to also forget the definition after a time limit. Why the gap is narrow even then: the sentence only shows on an OFFLINE row (an agent with no live session), and a task whose process ends leaves Running, so its word moves at the moment the row could first say it. The case left is a task switched off while its process is up and the board cannot see its session (#668's running-unseen row), which shows the running-unseen sentence instead, not this one.

## Not measured on a real Windows board
Read from code and the schtasks shapes the existing win32 tests already pin.
