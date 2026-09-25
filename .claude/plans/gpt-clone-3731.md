# Gemini and Grok Connect: an exact clone of GPT's flow (kosmos#3731)

Josh, testing 0.6.94 (2026-09-25 07:45, verbatim on the card): the Gemini/Grok panel opened under
Grok whichever row was pressed, talked about a command-line tool, offered an API key before
anything was installed, and Grok's "Sign in with your Grok subscription" went to a second screen
asking to sign in again. "Match the exact design and styling and flow of how GPT does."

## Call
- **First run.** Gemini and Grok each get GPT's four panels (fr-openai-* cloned, same classes,
  GPT's copy with the provider's name) DIRECTLY UNDER THEIR OWN ROW: install ("In order to connect
  to Google Gemini we need to download the installer." Confirm / Not now, progress), the choice
  ("Download complete. Choose how to connect xAI Grok." Sign in with Subscription / Use an API key),
  the sign-in, the key ("Download complete. You will need an xAI API key to finish..."). One driver,
  frKeyed*, keyed by provider, replaces #3658's shared box and #3713's download box (both sat below
  Grok). frCollapseProviders keeps one panel open across all four providers.
- **Grok's subscription goes straight to xAI**, first run AND Settings: the choice starts the sign-in
  itself (#3335's rule for GPT). The step's own Sign-in button shows only as the retry after a failed
  or stopped sign-in (the driver re-shows it).
- **Gemini's subscription is Angel's Antigravity sign-in (#3568), and its route does not exist yet.**
  Until it does, Gemini goes install -> key step (no one-button "choice"). KEYED_SUB_START.google
  (a start function, null today) is the one place that turns the choice on; the pick-sub button,
  sub-step markup and the step's own sign-in button listener are already there.
- **Settings > AI Models.** The install step uses GPT's Settings copy and a Confirm button; Grok's
  choice reads "Choose how to connect xAI Grok." / Sign in with Grok / Use an API key.
- **No command-line talk anywhere.** keyedInstallAsk is GPT's sentence; the Windows line is "Kosmos
  cannot connect <name> on Windows yet."; the (now unreachable) Mac grokMissingTool line too.
- Never an API key box before the software is installed (Connect asks /api/runners first).

## Weakest premises
- Gemini has no subscription option until #3568's route lands (Angel's). It is one flag, noted on the
  card for her.
- Settings' GPT subscription still has its intermediate screen (#3335 changed first run only); Grok's
  now skips it in both places, as Josh asked for Grok.

## Tests
- render-firstrun-keyed-connect-3658.js rebuilt (29 arms): placement under each row, no command-line
  or "runner" words, install first, Not now, refused install, progress, Gemini key step, Grok choice,
  Grok's sign-in starting at once with no second screen, the key (all #3658's arms), Windows. Before
  and after screenshots: ~/.cache/claude-handoffs/shots-3731/.
- render-grok-subscription-3391.js: first run ported to Grok's panel (30 arms); Settings Windows arm.
- render-keyed-install-3713.js: first-run arms ported, Settings copy (21 arms).
- web.firstrun-model.test.js: slice tripwire 44000 -> 49000 (measured 46213; create form 108398 away).

## Review pass 1 (opus): 0 blockers, 6 warnings, 3 nits, all taken
- W1 CSS: the result and progress lines under Gemini and Grok share GPT's rules (spacing, type).
- W2 connected: GPT's gold .fr-connbox via frCheckRow ("<Full name> is connected", "This computer is
  signed in [as email]."), and GPT's Next when Claude is not connected (#2134).
- W3 Grok's Stop returns to the choice (frKeyedShowPick), as GPT's does.
- W4 timeout copy says "Press Confirm to check again." (the button is Confirm now).
- W5 Settings: no key box or Grok choice before /api/runners says the software is here; an answer that
  is not "present" shows the install; Windows shows the plain sentence with nothing to press. A Grok
  sign in again still opens straight onto the sign-in (the account exists) and the probe still swaps
  in the download if the software has gone. Focus moved into acctKeyedReveal (after an install it
  always moves to what is showing).
- W6 frKeyedCollapse bumps FR_KEYED_GEN, so a late read cannot reopen a panel GPT's (or Claude's)
  Connect closed. Arm proven red without it; it had been green-for-the-wrong-reason twice (GPT's own
  late read re-collapsed, then the arm's tidy-up ran before its read).
- N1 KEYED_SUB_START map; N2 bar and progress reset on reopen; N3 arms for each.

## Focus ring (Josh, 0.6.94, via Splinter: "is there really a blue stroke around the buttons?")
- It was the focus moved to "Sign in with Subscription" after the download, drawn in the browser's
  blue. Now Kosmos's ink ring (#firstrun .fr-confirm .btn:focus-visible), like the step's other
  buttons; keyboard users keep the focus move.
- Measured in Chromium AND WebKit: after a REAL mouse press the browser draws no ring there at all.
  The stroke in the screenshot came from the check pressing buttons by script (no mouse event). So a
  "hide the ring for mouse users" rule was built, perturbed, and found to change nothing in either
  engine; it was removed rather than shipped as decoration. The check now presses Connect and Confirm
  with the real mouse and asserts: no ring after the mouse; the ink ring (resolved --k-ink, not
  rgb(0,95,204)) after Tab / Shift+Tab. Screenshots redone.
- Weakest premise: only Chromium and WebKit were measured. Firefox was not, and which engine each
  person's board opens in was not measured either; an engine that did draw a ring after a mouse press
  would now draw Kosmos's ink ring rather than blue, not none.

## Review pass 2 (sonnet): 0 blockers, 1 warning, 2 nits
- W: Settings' Add a provider buttons still drew the browser's blue -> #acct-add-dialog .btn:focus-visible
  ink ring; arm red without it (rgb(0, 95, 204)).
- N: aria-controls lists 2 of 4 panels, byte-for-byte as GPT's does; two copies of the install sentence
  (Settings JS, first-run HTML), GPT's convention. Not taken: both are faithful to GPT.

## Review pass 3 (opus): 0 blockers, 4 warnings, 7 nits
- W1 a slow paint left Gemini's key form open under "connected" -> the connected paint collapses an open
  panel, as GPT's does (#2621). Arm (held /api/accounts read) red without it.
- W2 Settings' Grok Stop stayed on the sign-in -> back to the choice, as GPT's Settings Stop does; a sign
  in again (no choice) keeps its own step and retry. Arm updated.
- W3 the "nothing before the install check answers" rule had no arm that could fail -> r11 pending arm,
  red with the old show-at-once code.
- W4 the visit guard in acctApikeyShow was unguarded -> r11 switch arm. It was blind at first (Grok's own
  slow read landed last and hid the reopen); only Gemini's read is slow now, red without the guard.
- N1 failed-start retry -> arm, red without go.hidden = false. N4 frKeyedConnect pressed again collapses
  its own panels first (and ends a sign-in in flight); acctKeyedWindows leaves Grok's sign-in.
- Not taken, with reasons: N2 (Next's FR_STEP/claude guards are correct, the reviewer confirmed; the
  mid-Claude-sign-in overwrite is GPT's documented #2134 limit); N3 (a cleared "key saved" line when
  another Connect is pressed; the button still says Key saved); N5 (a failed runners read on Windows says
  it cannot connect: the read failing is itself not connectable); N6 double focus (harmless); N7
  "Download complete." with nothing downloaded (GPT's copy, clone-faithful).
