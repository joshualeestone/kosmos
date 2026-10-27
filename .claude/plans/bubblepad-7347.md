# bubblepad-7347: the iPhone DM fixes from Josh's 10-27 batch, one PR

Cards: kosmos#7265 (open DM jumps on refresh, opens short), #7348 (sent text comes back into the box),
#7346 (floating message box, Send key sends), #7347 (bubble padding), #7344 (keyboard hides the newest message).
Stacked branches, shipped as one PR: dmkeep-7265 -> composer-7348 -> floatbox-7346 -> bubblepad-7347.

## Finished looks like

On Josh's iPhone (TestFlight build 8): an open DM at the newest message follows each new one and a reader scrolled up
holds still while messages arrive; a long DM opens on its newest message; text just sent never reappears in the box;
the box floats as one rounded field with no send arrow and the keyboard's Send key sends; bubbles have 10 by 14 pt
padding; opening the keyboard at the newest message keeps it in view. Not "solved" until his phone confirms it.

## Steps (all built, see each branch's commits)

1. #7265 (dmkeep): iOS 17+ anchors the chat on a message id (scrollPosition(id:) + scrollTargetLayout); every jump to
   the newest goes through goNewest (anchor "end"); the re-pin is a counter, not a flag; on iOS 18 only the person's
   own scroll moves atBottom (PersonScroll). iOS 16 keeps the eager newest rows. Debug KOSMOS_SAMPLE_* hooks for the
   simulator. Measured on the simulator r12 to r15 against a control (KOSMOS_SAMPLE_NOPOSID=1).
2. #7348 (composer): the sent text filling back within 5 s is cleared again, DM and room; a failed send keeps its words.
3. #7346 (floatbox): the floating box (Mona Lisa's design), Send key sends, pasted breaks kept, room @name first.
4. #7347 (bubblepad): 10 by 14 pt bubble padding.
5. #7344: no own commit. The keyboard path (keyboardWillShow reads atBottom, keyboardDidShow calls goNewest) was broken
   only because atBottom was wrong; #7265 fixes atBottom. Weakest premise: not measured with a keyboard on the
   simulator (it cannot type); the phone build is the check.

## Verify

LogicTests run.sh (1391), run-composer.sh (59), run-room.sh (425), typecheck for iOS 16 simulator, all green after
the rebase onto dmkeep a934f5f2e1. Each branch was blind-reviewed when built.

## Review bound

Challenge loop on the whole diff, two rounds then PR; anything later is a card. Beta rule (Josh 08-19): merge on green.
