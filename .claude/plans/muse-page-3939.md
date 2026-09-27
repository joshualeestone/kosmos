# #3939 slice 3b (first part): Meta Muse in Settings > AI Models > Add a provider

Splinter, 2026-09-27 05:18: build the Meta Muse provider UI against a stub muse, behind the flag. This part covers Settings' Add a provider only. The first-run guided row, the AI Models account row and the create-agent option come in later parts. The engine side (slice 3a, #4209) is merged.

## What finished looks like
With GET /api/muse enabled, Add a provider's Meta option is live. Picking it shows a "Sign in with Meta" step that runs the engine's sign-in, shows Meta's page as a link and the code in the #3952 boxes, offers a new code when one expires, says a failure or done in words, and stops the engine's sign-in on Stop, on closing the dialog, and on a switch to another provider. With the flag off, the menu is exactly as today. A hermetic browser check proves each of these.

## Decisions
- **Only the option's disabled state is toggled.** The logo combobox re-reads it on open (syncOpts) and drops the "Coming soon" pill, but its row name is fixed at build, so the row reads "Meta / Llama". The step itself says "Meta Muse". Rejected: relabelling the option, which needs a combobox change that reaches three menus.
- **The id is the one the page's own start answered (slice 3a's carried item).** A poll that names another id (another tab's start replaced it) ends this screen's sign-in in words, and nothing is sent for the other one.
- **"Done" repaints the accounts** and says "Signed in to Meta Muse". The AI Models row for Muse comes in a later part.
- **A failed read of /api/muse keeps "coming soon"**: today's screen, never a guess.

## Weakest premise
That no screen needs a Muse row after "done" to make sense. Today, "done" says so in the dialog, and the account row comes later.

## Review round 1 (decided)
- Focus is never stranded (#1918). One hideRow helper moves focus inside a row that is about to hide to Stop while the sign-in runs, else to the button; finish's own focus return was dead code and is removed. It covers Get a new code, an expiry with focus on the link, and a failure with focus on Stop. Controls red. Retry's in-flight guard is a flag, not disabling the button, because disabling a focused button drops focus to the body.
- An idle poll (no id, e.g. the board restarted) says the sign-in ended, not "another started".
- Choosing Meta stops a ChatGPT sign-in, as acctPick does for every other choice. Control red.
- One fact for "offered": museOffered() reads the option's own disabled state; MUSE_ON is gone.
- A hidden Meta link keeps no address (the 0.6.96 rule). A refused start gives focus back to the button. A retry failure after Stop paints nothing.
- The check now covers a late start after close, a poll after Stop, a retry after Stop, a mid sign-in switch, the key step, the ChatGPT sign-in, the focus paths and idle. The reviewer's surviving mutations are each red now.
- Accepted, as the plan decides: the combobox row reads "Meta / Llama", and the button is back beside "Signed in to Meta Muse".
