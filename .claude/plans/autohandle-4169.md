# autohandle-4169: only the folder-trust dialog is auto-restarted

kosmos#4169, assigned by Liu Kang (m1451). The board's class-1 auto-handle (#2808, engine/class1-autohandle.js) restarted
working agents 53 times in one night on Mortals, each restart wiping the agent's context mid-task.

## Measured (before changing anything)
board.log's restart lines carry no timestamp, so the arm was measured from the agents' own self-report logs
(`selfreports/<agent>.jsonl`): a restart writes `stopped` then `started`, and the report before it is what the agent was
doing when the board restarted it. Since 2026-09-26 22:00Z, 19 restarts were matched (kano 8, scorpion 8, johnnycage 2,
sonyablade 1): **18 followed a by:auto "asking permission to use Bash: ..." report** (kill, pkill, ps, find /, adb, a
scratch script), one followed an ordinary working report (scorpion 03:30:28). None was the folder-trust dialog. This is
the matchable subset of the 53, not all of them (raiden's and liukang's files show no restart pairs).

## Done looks like
A working agent that hits a tool-permission prompt is not restarted (tests that fail on main), the folder-trust dialog
is still auto-cleared (every existing trust-dialog test green on main and on the branch), and the log line says which arm
fired and the prompt behind it, so tomorrow's board.log can show the count near zero and name any that remain.

## Change
- engine/class1-autohandle.js `standingFromAgent` (the armed sweep's adapter): only the trust-dialog screen scrape maps
  to the class-1 marker `by: 'auto'`. A bare by:auto self-report (the hook's PermissionRequest) maps to
  `'auto-tool-permission'`, which is not class-1, so planClass1Handle plans `none` and the card keeps its needs_you.
  The standing also carries `arm` ('trust-dialog' | 'tool-permission' | null) and `prompt` (the screen line or the
  report text, one line, 120 chars).
- sweepOnce passes `arm` and `prompt` to the log callback; server.js's class1 log line appends
  `[arm=...; prompt="..."]`.

## Rejected
- Tightening `selfreport.isAutoPermissionWait` (the class-1 predicate's single home): record()'s clobber-guard uses it
  too, and that guard is right to treat a hook permission wait as clearable.
- Answering the tool prompt instead (send-keys): the header's whole safety argument is that no key is ever typed into
  a pane.

## Decided, not missed
- The dry-run bin (bin/class1-autohandle.js) reads raw self-reports through sweepClass1 and still PRINTS
  trust-and-restart for a by:auto report. It takes no action, so it is left; noted here.
- A tool-permission prompt now waits for a person, as a class-2 question does. In bypass mode these are the few
  commands Claude Code still asks about; before, the restart hid them and the relaunched agent met them again.

## Weakest part
The one restart after an ordinary `working` report (scorpion 03:30) is unexplained by this; it may be a real trust
dialog at relaunch or a stale by:auto card. The new log line will name its arm next time.

## What would change my mind
A board.log line tomorrow reading `arm=trust-dialog` on an agent that was mid-task (a scrape false positive).
