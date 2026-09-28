# #4332: the Daily report switch's unreadable-setting dead end (Sonya Blade, 2026-09-28)

## Rule (#4308, applied again on #4323 by Liu Kang)
An unreadable setting reads as off, is shown to the person as unreadable, and is repaired by the person's own
action (turning it on rewrites the file). Never a silent dead end.

## Finished means
1. With an unreadable Daily report settings file, the Settings switch shows Off with a line saying the setting
   could not be read and that turning it on sets it again.
2. Turning it on rewrites a valid file.
3. A test goes red on main.

## What was there
- engine/feedbacksend.js already did the right thing: a present-but-unreadable file reads `{on:false, ok:false}`,
  the send gates (`if (!read().on) return`, lines 384 and 422) read it as off, and `setOn` rewrites over it. The
  only other writer, `markSent`, runs only after a send, which cannot happen while the file reads off.
- The dead end was only on the page: `feedbackPaint` treated `ok:false` exactly like NO answer (a 403 or a failed
  fetch), hid the switch and said "Open Kosmos from its icon and you can change it", which cannot help.

## Decision
Two different could-not-reads:
- **No answer** (a failed fetch, a 403 on an enforcing board): unchanged. The switch stays hidden with no position,
  because the page does not know the setting and a false Off on a privacy switch is the failure #2047 prevents.
- **A damaged file** (the board answered, `ok:false`): the engine reads it as off, so Off is TRUE. Show the switch
  Off with "Your Daily report setting could not be read, so no report is being sent. Turn it on to set it again."
Rejected: repairing the file silently on read (it would erase the person's chance to see that it was damaged, and
could flip a person's off to the default on); a separate Repair button (the switch already does exactly that).

The install-time surface (first-run step 6) already shows a damaged file as Off and its switch repairs it, so it
is not a dead end and is left alone.

## Weakest part
"so no report is being sent" is true because the send gate reads `read().on`; if a future change made the send
path ignore `ok:false`, this sentence would become false. The send gate is pinned by the existing #2037 tests, not
by this card.

## Checks
- web.feedback-unreadable-4332.test.js runs the page's real paintSwitch + feedbackPaint on a fake document: the
  damaged arm is RED on main and green here; the no-answer (privacy) arm and the readable control pass on both;
  the repair (setOn over a damaged file writes a valid on file) is pinned.
- docs/browser-checks/render-optout-403-2020.js gains a DAMAGED arm. On a sandboxed board from this branch: 11/11
  PASS. With main's page: the three damaged-arm lines FAIL.
- Real board, real file: a cut-short feedbacksend.json reads {on:false, ok:false}; PUT {on:true} answers
  {on:true, ok:true} and the file is {"on":true}.
- web.feedback-switch-2037.test.js's source pins follow the two-case shape.
