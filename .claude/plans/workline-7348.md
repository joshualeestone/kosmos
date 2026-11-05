# kosmos#7348, the third step: the "is working" line moves the conversation after a send

## Measured
Sample DM with Dana going idle to working as a paced send's post answers, on #8034's layout: the conversation moves 27 pt in one step as the line appears. The earlier plan (sendscroll-7348) called this unmeasured; this replaces that.

## Finished looks like
With the line appearing, the sent message and the one above it do not move (SendMovesOnceUITests, third check, 1 pt). Without the room kept, that check fails. The new checks really run on CI's slow runner: not skipped.

## Call
The line always has its room, drawn hidden when the agent is not working, in every chat. The same id both ways; no timer, nothing new scrolls.
Rejected, measured: keeping one view at no opacity. The dots kept animating, the test's looks fell from 16 to 3 or 4, and the line stayed in the accessibility tree, so a person using VoiceOver would hear an agent working that is not.
Rejected: a timed hold from the send until the agent works (my first plan, on the card). Angel pointed out that releasing it is the same 27 pt step, later, for an agent that does not start, and nobody has a measured time for how long a real agent takes.
Rejected: room only while the agent is running (review 1): nothing follows that changing, so it could bring the step back under a reader at the newest. Always is simpler.
Cost, stated: every chat has 27 pt more space under its newest message, including with the keyboard up.
Out of scope: a project room's own working line above the composer, which may move its list the same way; not measured.
Weakest premise: that the extra space looks fine. To be judged on screenshots here and on the phone; if it reads as a gap, the fallback is taking the room back and accepting one step.

Measured on this branch, one device, 2 runs per arm: without the room the new check fails at 27 pt (including at load 70 with only 4 looks); with it, all 3 checks pass at 0 pt, read seen each run.
Looked at, idle and working, iPhone 17e with the keyboard up: working is unchanged. Idle has about 27 pt more space under the newest message and shows that much less history. It reads as breathing room, not a hole. My judgement on a simulator; Josh's phone decides.

## The check, so it works on CI
#8034's two checks SKIPPED on CI: they asked for many looks, and a slow runner cannot give them. A step is a lasting offset, so one look before the post answers and one after the read are enough. The pace widens from 1.5 s to 5 s, so a slow tap still returns in time. A skip now means only that the tap outlasted the post. ui-sample.sh names each skip and its reason, since its log is deleted with the run.

Review 3: a first reading that finishes after the post answers is a skip too, not a failure. The UI job's step output gets read for SKIPPED before merge, since a skip still prints PASS.

Final review: a pending bubble not seen on a slow runner is a skip, and the idle sample only applies with the pacing flag. Left: the id stays on the room though nothing scrolls to it, keeping the row's id as it was.

## Not seen
A real iPhone and board (#8019).
