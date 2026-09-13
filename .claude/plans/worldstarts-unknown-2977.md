# #2977 - worldstarts pause treats an unreadable switched-off state as "on"

## Problem
`engine/worldstarts.js` `jobIsSwitchedOff` failed soft to "not off" when the
switched-off read FAILED. A failed read then pauses-and-records the agent, and the
matching resume later switches an agent that the person had switched off back ON -
overriding their choice. Windows window: `remove.jobFor`'s LIST read succeeds (task is
ours), then `win32job.taskEnabled`'s `/Query /XML` read fails ~20ms later. Mac: the
`create.disabledJobs()` probe fails and its catch returns an empty set, read as "nothing
is off". #2978 made the Windows read locale-independent (XML via `taskEnabled`) but
explicitly KEPT the error semantics ("A look that fails is still 'not off', as it always
was"), so the card is still live on both arms. The card asks to decide the rule for both
Mac and Windows.

## Fix (tri-state: off / on / unknown)
- `engine/worldstarts.js`: `jobIsSwitchedOff` -> `jobSwitchState` returning
  `'off' | 'on' | 'unknown'`. Windows keys off `win32job.taskEnabled`'s `known:false`
  (its XML read would not answer / unreadable shape). Mac keys off a new failure-signaling
  probe. On `unknown`, the pause loop pushes a `notPaused` entry ("we could not tell
  whether X was switched on, so we left it as it was") and NEITHER pauses NOR records it -
  so a resume cannot switch an off agent on. An `on` agent keeps running through the
  switch (the lesser harm than switching an off one on).
- `engine/create.js`: add `disabledJobsResult()` that returns `{ok:false}` when the probe
  could not look (thrown, or a runner/gate `ok:false`) and `{ok:true, jobs}` otherwise.
  `disabledJobs()` now delegates to it and keeps its fail-soft-to-empty-Set contract for
  every existing caller (byte-for-byte behaviour unchanged for them).
- `win32job.js` UNCHANGED: its `status()` is a boolean "on purpose" (its doc says read
  `presence`/`taskEnabled` where the answer becomes a decision); the Windows arm now reads
  `taskEnabled`, whose tri-state already existed.

## Weakest premise (owned)
`unknown` leaves an agent whose state we cannot read RUNNING through the switch rather than
pausing it. That is strictly better than the bug (switching an OFF agent ON), it matches
the card's suggested rule, and the read fails only in a narrow transient window; the
moment the read succeeds the right thing happens. A "working somewhere" surfacing of the
un-paused-because-unreadable agent is a copy follow-up if wanted.

## Tests (mutation-verified non-vacuous)
`engine/worldstarts.test.js`: Windows unknown (`winXmlFails`: LIST read ok so jobFor sees
it as ours, XML read fails -> taskEnabled known:false), Mac unknown (`macProbeFails`), and
an end-to-end "unknown pause records nothing so the resume switches nothing on". All three
redden when `jobSwitchState` is mutated to treat unknown as `'on'`.
`server.world-switch-agents-1704.test.js`: completed the Windows mock to answer the
`/Query /XML` read with a readable enabled definition (its old LIST-only `Status: Ready`
read as unreadable under the now-correct unknown semantics). Full suite green (6807/6807).

## Delivery / gate
Kosmos engine change (no web/ change, so no #1720 browser-check gate). Staging-first;
prod stays Josh-gated. Sibling infra #2955 (board watchdog) merged; #2958 (fleet
reachability) is PigeonPete's. Built on #2978 (3b0e86bd).
