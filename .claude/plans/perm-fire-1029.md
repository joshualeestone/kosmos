# #1/#2: permission buttons fire the real macOS prompt (Josh 0.6.39)

## Problem

Launch-gating. Josh's fresh-account 0.6.39 test: the permission screens' grant
buttons never fired the real macOS prompts ("Terminal would like to access your
files"); they only appeared later at Import, and tmux was not even in the
Accessibility list, so it could not be granted.

## Approach

Rewire the S2/S3 grant buttons from "open System Settings" to "fire the native
prompt" via Kitty's kosmos-relay trigger contract:
- S2 "Allow Access"  -> POST /api/file-access-prompt
- S3 tmux "Turn On"   -> POST /api/a11y-prompt (also injects tmux into the list)
- sleep is programmatic (pmset), not a prompt: it keeps opening Energy settings.

A helper frFirePermission(trigger, fallback, msg) POSTs the trigger; {ok:true} is
done (the prompt fired). On {ok:false}/non-ok/error it falls back to opening
Settings, so nothing regresses before Kitty's endpoints ship or in a browser.

#2 (Next disabled until granted) already exists: frPollGates keys #fr-next on the
FR_GATES detection routes (/api/file-access-status, /api/a11y-status), unchanged.
The button fires the prompt; the poll (not the click) detects the grant and unlocks
Next. The load-onto-screen-9 of Documents/Downloads agents (Splinter's #5 note)
follows once these grants let the scan reach those folders.

## Coordination

Kitty owns the trigger endpoints (native-app in kosmos-relay); she gave the exact
contract and is building them, HEADS-UPing as each goes live. My UI wires against
the contract with the Settings fallback, so it is correct before and after her
endpoints ship.

## Tests

- web.firstrun-a11y-1214.test.js: the S3 handler fires a11y-prompt and falls back.
- click-first-run.js section 12 (served-board browser-check): S2/S3 fire the trigger,
  do NOT also open Settings, and fall back on {ok:false}, with the refusal spoken.
- Verified in a real browser (self-boot): 5/5 - trigger fires, no double-open, fallback.

## Weakest premise

The live trigger endpoints are not served yet, so the trigger path is verified with
mocked responses, not against Kitty's real native mechanism. Her weakest premise (the
under-tmux AX attribution may need deeper native work to reliably surface tmux) does
not change this UI wiring: trigger + poll + flip + fallback is stable either way.
