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
