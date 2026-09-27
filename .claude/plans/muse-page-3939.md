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

## Review round 2 (decided)
- Turned on but Muse Code not installed: the Meta option stays disabled, and its row pill says "Muse Code is not installed" (data-off), as Gemini's and Grok's rows wait until they are ready. Installed again clears the reason. Control red.
- Tests for acctPick's own stop (the reauth doors reach it without the select's change) and for the double press of Get a new code (one retry). Controls red.
- One museMetaOption() lookup.

## Review round 3 (decided)
- The check now sees flag off: there is no reason on the option, and the row's pill reads "Coming soon". It also sees a failed read (a 500 and a throw), which keeps Meta coming soon with no reason. Controls red.
- The dialog's intro names Meta Muse when it is live, swapping the plain Add screen's sentence only, never a sign-in again's. Control red.
- An open logo list refreshes when museAsk answers (sel.value = sel.value, as the sibling painters do).
- "Not installed" is the engine's own reason (GET /api/muse `because`), not a second spelling.
- Meta goes through acctPick like every live provider, so there is one rule for putting the others away. acctPick shows Muse's step for meta and puts it away otherwise. Control red.
- Rebased onto main: the reason-grep count is main's 191 plus this check's 2, which is 193, re-measured by the test.
- Nits left: the poll has no overlap guard (Grok's driver has the same shape); a refused start refocuses the button even if the person tabbed away; the signedIn field is unused until the AI Models row part.

## Review round 4 (decided)
- Stuck is tested both ways. With a code (the engine's NOT_WAITING), it says why and keeps the code and Meta's link, because Meta's page may still take the code. Stop is offered and no retry. With no code, it says why and offers Stop. Control red.
- The not-installed fallback is deliberately not a copy of the engine's sentence ("Not ready on this computer"); the engine's `because` is what shows.
- museAsk's latest read wins (a generation counter), so two quick opens cannot leave the option stale.
- Not a finding: "no proof file". The proof is written when this loop converges.
- Noted, not rewritten: during the rebase, one commit's subject began with "#3939" and was taken as a comment, leaving it with no subject line. The PR is squash-merged under its title, so it does not reach main.

## Review round 5 (decided)
- The check now proves three behaviours the rounds had decided but nothing could see: the latest /api/muse read wins; a list already open drops Meta's disabled state and pill when the answer lands; and the intro swap leaves a sign-in again's sentence alone. Controls red.
- ACCT_ADD_INTRO_MUSE is derived from ACCT_ADD_INTRO (one sentence), with a check that the derivation really changed it.
- Muse's step put away with focus inside moves focus to the provider picker, not the page body. Control red.
- A reason that already says to start again is not followed by "You can try again". Control red.
- Two stale comments removed.
- Accepted: on reopen, the option can hold the last visit's answer until this visit's read lands (one local fetch; a start in that window refuses in words). An unreachable board is not named during polling, as with Grok's driver.

## Review round 6 (decided, converged)
- 0 BLOCKER, 0 WARNING (sonnet, after opus round 5); five mutations of decided behaviours are each caught by the check.
- Its one CONVENTION finding is judged not an issue: the plan filename carries no timestamp. It is the <branch>.md form every plan in this repo uses, and the one the pre-PR plan gate accepts (muse-run-3939.md, muse-ui-3939.md passed it). Renaming this one alone would diverge from the gate and its siblings.
