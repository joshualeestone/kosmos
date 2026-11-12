# windisabled-8417: Windows shows a switched-off agent as switched off

Addresses #8417. Found in #8410's review 3 (Ice Cream Kitty), the sibling of #8410's runningJobs fix.

## Done when
1. `create.disabledJobsResult(undefined, 'win32')` names the agents whose Scheduled Task is switched off, `{ ok: false }` when the Kosmos folder could not be listed, and never asks launchctl.
2. A task switched off by hand in Task Scheduler (no Kosmos disable, so no cache bust) shows at the next poll, at the cost of the one folder query per poll.
3. The offline row's sentence on Windows names Task Scheduler and the task, not System Settings.

## Decided
- **Source of truth: the task's own `<Settings><Enabled>`** through `win32job.cachedTaskSpec` (the #2717 cache), as the card suggests and as the trust card already does. Rejected: the CSV Status word as the answer, because it is localized (a German Windows would never say switched off), and an uncached `taskEnabled` per agent, because the board polls every 5 s and register.js measured ~18 ms per schtasks call.
- **Freshness from the Status word, compared and never interpreted.** `win32job.switchedOffNames` reads the one folder query `list` already makes (now `folderRows`, shared). When a task's Status word differs from the one it had on the previous call, or the task is new to this process, its cached definition is forgotten and read again. A hand switch-off moves Ready/Running to Disabled in any language.
- **Could-not-look stays distinct:** a failed folder listing is `{ ok: false }`; an empty folder ("cannot find") is a real empty set. One task whose definition could not be read (or whose switch is neither true nor false) is left out of the set: this feeds a sentence, and an unread task is not said to be off.
- **The injected `runner` is ignored on win32.** It is a launchctl runner (machine.agentAutostartCheck), and every caller that passes one is darwin-only; worldstarts excludes win32 before asking. So this arm reaches only the board's display path (server.js jobSwitchedOff and switchedOffSentence).
- **Sentence:** "this agent is not running because its background job was switched off in Task Scheduler. Open Task Scheduler, find agent-<name> in the Kosmos folder and choose Enable, and it can start again". The task name comes from `win32job.taskName`, so a named Kosmos says `agent-<name>+<world>`. No full stop, as the Mac and Linux sentences.
- **Overlap with #8410 (winroster-8410, open):** it edits `runningJobs` just below; this edits `disabledJobsResult` and `switchedOffSentence`. Separate hunks; rebase on whichever lands first.

## Weakest premise
That the Status word changes whenever the switch does. Measured nowhere on a real Windows: it is read from Microsoft's documented Status values (Ready, Running, Disabled, Queued). If a task could be switched off while its Status word stays the same (say it reads Running while its process is still up after a disable), the cached definition would say on until the word next moves. What would change my mind: a real Windows box where `/Change /DISABLE` on a running agent task leaves Status at Running. Then the fix is to also forget the definition after a time limit. Why the gap is narrow even then: the sentence only shows on an OFFLINE row (an agent with no live session), and a task whose process ends leaves Running, so its word moves at the moment the row could first say it. The case left is a task switched off while its process is up and the board cannot see its session (#668's running-unseen row), which shows the running-unseen sentence instead, not this one.

## Not measured on a real Windows board
Read from code and the schtasks shapes the existing win32 tests already pin.
