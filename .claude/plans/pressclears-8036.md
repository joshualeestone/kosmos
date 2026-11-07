# pressclears-8036 (kosmos#8036): Josh's iPhone sighting 11-06 20:25

**Finished looks like:** pressing a permission prompt's button in a chat is never followed by "asked you something"; a second wait does not repeat the ended sentence under itself; a press that did not close the prompt, a next prompt, a newer report and an agent's own question all keep their wait.

**Measured, from the session and report log:** the Yes approved a live prompt. The banner is the hook's report standing until the agent's next report (14 s there), served through the #2456 fallback with no menu. The doubled line is two separate waits, 18:42Z and 23:30Z.

**Change:** server.js only. `permissionWaitBeforePress` before the key, `endPermissionWaitPressed` after a press that answered it: only the hook's wait, only if that report still stands (same `at`), only if the screen shows no next menu. It records working by auto and consumes the wait's marks, so no ended line follows. The ended line is skipped when the chat's last row already says it.

**Rejected:** hiding the reported row whenever the pane shows no prompt: a pane the reader cannot parse would bring back the original #8036 symptom, a list saying Needs permission and a chat showing nothing. Changing the phone's words: needs a TestFlight and leaves the false row. A PostToolUse report: wider than the sighting, and it would touch every agent's hook set.

**Weakest premise:** pressing No. If Claude Code ends the turn without a Stop hook, the card reads working until the next report rather than needs_you. Neither is true of an agent that stopped; the new one reads busier than it is.

**What would change my mind:** a phone read that still shows the row after a placed press, or a press on a prompt whose report arrives only after the press.

**Not covered:** a wait answered at the computer leaves the same gap until the next report.
