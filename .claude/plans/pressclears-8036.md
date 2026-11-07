# pressclears-8036 (kosmos#8036): Josh's iPhone sighting 11-06 20:25

**Finished looks like:** pressing a permission prompt's button in a chat is never followed by "asked you something"; a second wait does not repeat the ended sentence under itself; a press that did not close the prompt, a next prompt, a newer report and an agent's own question all keep their wait.

**Measured, from the session and report log:** the Yes approved a live prompt. The banner is the hook's report standing until the agent's next report (14 s there), served through the #2456 fallback with no menu. The doubled line is two separate waits, 18:42Z and 23:30Z.

**Change:** server.js only. `permissionWaitBeforePress` before the key, `endPermissionWaitPressed` after a press that answered it: only the hook's wait, only if that report still stands (same `at`), only if the screen shows no next menu. It marks the wait (`pressedWaits`, session to the wait's `at`) before the key, so a report landing during the 1.2 s settle, or after an unconfirmed press, says no ended line while still acknowledging the push; a refused or thrown press restores the mark that stood. It records idle by auto (a screen showing the agent running outranks a reported idle) and consumes the wait's marks, so no ended line follows. The ended line is skipped when the chat's last row already says it.

**Rejected:** hiding the reported row whenever the pane shows no prompt: a pane the reader cannot parse would bring back the original #8036 symptom, a list saying Needs permission and a chat showing nothing. Changing the phone's words: needs a TestFlight and leaves the false row. A PostToolUse report: wider than the sighting, and it would touch every agent's hook set.

**Weakest premise:** idle for the seconds after a Yes, on a screen the classifier does not read as working: the card reads idle until the next report. Rejected working: after a No the agent can sit at its prompt, reading mid-task for 5 minutes and then unknown.

**Accepted, named:** a second wait's push still goes out when its line is skipped, so a person opening on that buzz reads the same sentence dated earlier. An idle dated at the press: sweeps reading idle age could count from it on a screen not read as working, which a running or thinking screen is not. An unconfirmed press that never took and then times out says no line, since the person was told it was unconfirmed. After a No the agent may sit at its prompt with no Stop, so a colleague's un-addressed room post is held until its next turn (roomhold's own comment already accepts this for a turn that ends without a Stop); the person who pressed No normally types next. A half-drawn frame at the settle capture can read as no menu and end a wait still standing: the card goes red again if the screen reads the prompt, but the phone stops offering Allow.

Also accepted: `communityturn` reads the press's idle as a turn end, so a Yes inside a Kosmos-woken turn can close that window early (bounded by its one prompt per post). A hook firing again for the same prompt during the settle changes the report's time, so that press keeps the wait and can still say the line. An unreadable settle capture hides the row until the agent's next report.

**What would change my mind:** a phone read that still shows the row after a placed press, or a press on a prompt whose report arrives only after the press.

**Not covered:** a wait answered at the computer leaves the same gap until the next report.
