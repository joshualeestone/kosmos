# #3939 slice 3: Meta Muse provider UI against a fake muse (Splinter, 2026-09-27 05:18)

Splinter's ask: the Add a provider > Meta row, a sign-in step showing the device code in the #3952 boxes, the account row in AI Models, and a "Meta Muse" option in create-agent, all behind a flag and tested with a fake muse. The real sign-in on the Mortals Mac is the last check. Page merges wait for Baron's 0.7.01 freeze.

## What finished looks like
With the flag on, on a Mac with Muse Code installed, a person can pick Meta in Add a provider, see Muse's device code in the big boxes, approve it in the browser, and see a Meta Muse account row in AI Models. Create-agent offers Meta Muse. With the flag off, every screen is exactly as today (Meta stays "coming soon"). Each step is tested against a fake `muse` that prints the login screens Homer captured.

## Split (each its own PR, so engine work can merge during the page hold)
- 3a (this branch first, engine and server only): the flag, `engine/musesignin.js` (drives `muse login` in tmux on Kosmos's own socket), signed-in state, and `/api/muse` routes.
- 3b (page, held for the freeze): the Add a provider Meta row, the sign-in step in the #3952 boxes, and the AI Models account row.
- 3c: the create-agent option and wiring slice 2's runTurn into an agent. That is the runtime adapter, the biggest piece.

## Decisions
- **The flag.** No flag for Muse exists yet (searched server.js, engine, web). New `AGENT_WORKFORCE_MUSE=1`, following the AGENT_WORKFORCE_* env switches such as FEDERATION_LIVE. It is off by default, so nothing changes for anyone. It is also Mac only (slice 1/2 gate), and there is nothing to sign in until Muse Code is installed.
- **Sign-in storage: Muse's default on a Mac (the login Keychain).** HOME and XDG are never overridden, which is what raised the keychain-reset dialog on 09-26. TBH_CREDENTIAL_BACKEND=file is Windows-verified only and would put a long-lived key in a plain file.
- **Signed-in state.** Muse has no `auth status` command. It counts as signed in when ~/.config/muse/auth.json holds a providers.meta entry (the file backend), or when Kosmos's own sign-in ended "Logged in" and wrote a marker in Kosmos's store. Kosmos never reads the Keychain: an item named "meta" could belong to anything. A later "missing meta credential" from a turn clears the marker (wired in 3c).
- **Driving `muse login`.** It prints a URL and a code, then "Press Enter to open it in your browser:" and only polls after Enter (Homer). Kosmos reads the URL and code, shows them in the boxes, and sends Enter, so Muse opens the browser and waits. "Logged in." means done. "expired before it was approved" means expired, and the panel offers a retry, which sends r then Enter. "saving failed" is a failure named in words. Env: MUSE_LOGIN=1, MUSE_NO_AUTO_UPDATE=1, MUSE_NO_MODIFY_PATH=1.

## Weakest premises (the Mortals run checks each)
1. The URL and code line format on a Mac: not captured, so the parser takes the first https URL and a device-code-shaped token (letters and digits with a dash).
2. That a Keychain save with the real HOME raises no console dialog (Splinter's 09-26 note: an "Allow / Always Allow" dialog is possible on first use).
3. That the `muse login` wording is the same on Mac as on Windows 1.4.0.

## 3a review round 1 (decided)
- `muse login` exits after "Logged in.", and the session going with it read as a failure with nothing recorded. The session command now prints an exit line and waits, so the last screen is read, then Kosmos kills it. The fake now exits like the real CLI. Control red.
- The stray-Enter check could not fail on a Mac (/bin/bash 3.2 refuses read -t 0.2). Whole seconds now; control red.
- A slow retry held: the old expiry line is ignored until the new code is drawn, and a second retry is refused meanwhile. Control red. The give-up clock restarts with each code.
- An Enter that did not move Muse on is sent once more after 5 s, then named as stuck. Control red. Two gone-misses in a row before a sign-in ends (the agysignin rule).
- One sign-in folder for the working folder and the mark (musestatus.signinFolder). The start failure message is a single constant.
- The code falls back to the address's user_code when no dashed code is printed (weakest premise 1).
- The test tmux sockets are removed, and the server test reads Muse's file from the sandbox home only.
- Carried into 3b: the page must keep the id from its own start POST, never from the GET (the GET hands the id to any caller). And the signed-in mark can outlive a sign-out until 3c clears it on "missing meta credential"; this is named in musestatus.signedIn's comment, and no screen reads it before then.

## 3a review round 2 (decided)
- Both round-1 margins now have tests with a stubbed tmux: one missed session check does not end a sign-in and two in a row do, and a send failure is named only after MAX_KEY_FAILURES. Each control (the margin lowered to 1) went red.
- The fake's self-check reads only its drawn lines, not its comments.

## 3a review round 3 (decided)
- A retry that gets no new code is given up after STUCK_MS and another retry is allowed; before, it waited silently for 20 minutes. Control red.
- "Opening your browser..." is a screen now, so a slow browser gets no second Enter. Control red. Muse moving on clears a reason left by an earlier stuck. Control red.
- The session line runs through /bin/sh: tmux uses the person's own shell, and fish refuses $?. This could not be run here (no fish); the real-tmux tests all pass through /bin/sh now.
- The screen phrases and the code finder read one spelling (PRESS_WORDS, EXPIRED_WORDS). Retry's screen re-check is tested (control red). MAX_KEY_FAILURES is exported and the test reads it.
- With the flag off, the three sign-in routes still answer (idle or a refusal). Nothing can start, and the route comment says so.

## 3a review round 4 (decided)
- A present-but-empty `providers.meta` entry reads as not signed in, now tested (control red). Nit left: the test's socket cleanup assumes /private/tmp when TMUX_TMPDIR is unset. That is correct on a Mac, and these tests are Mac only.

## 3a review round 5 (decided)
- A retry that gets no new code now ENDS the sign-in ("start the sign-in again"), rather than allowing another retry. That reverses round 3's re-allow: a second r typed while Meta is slow lands on the late code screen (measured by the reviewer). Control red.
- The 20-minute limit is a final failure with its own reason, not an expiry that looks retryable. Control red.
- Failed sends are counted per send, not per tick. A failure that proves the Enter never went out re-arms it, so a tmux that keeps failing reaches "could not reach" with a single code. Control red.
- The used code leaves the address too (dropCode, one helper for end and expiry). Control red. r and Enter go in one send.

## 3a review round 6 (decided)
- The live-execution gate is pinned by a test, as agysignin's C3 is: with the gate closed, start() throws in a test and records nothing. The control (start's pre-check removed, so the gate's throw is swallowed) went red. The exit line's constant goes through shq like the binary.

## 3a review round 7 (decided)
- A retry send that timed out counts as sent, following the enterOnce rule that a timeout says nothing about delivery. No second r can follow, and NO_NEW_CODE ends the sign-in if the keys never arrived. Control red.
- Tests for four branches that had none, each control red: a timed-out Enter is not re-armed; a slow tmux is not a gone session; a send that goes out clears the failure count; a retry restarts the give-up clock. The "no expired code" message is one constant.

## 3a review round 8 (decided)
- A sign-in whose mark Kosmos could not write ends "failed" ("could not record it"), not "done". On a Mac the mark is the only record Kosmos reads. Control red.
- One signinRefusalStatus helper serves the agy, win32 agy and muse sign-in routes (convention 5; it was a third copy).
- The exit marker uses underscores, so it can never match the device-code shape.
- Watch item for the Mortals run, deliberately not changed: screen matching is by substring, inherited from agysignin. A Mac help line that merely mentions "Opening your browser" would read as that screen.
