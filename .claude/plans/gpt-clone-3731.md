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
  Until it does, Gemini goes install -> key step (no one-button "choice"). KEYED_SUB_READY.google is
  the one switch that turns the choice on; the pick-sub button and sub-step markup are already there.
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
