# wnvoice-0716: What's New for 0.7.16 waits on voice being heard

## Why
Renet's rule (via Splinter, 2026-10-01 07:55): if voice is not HEARD working in the build, the "Talk to your agents"
highlight comes off What's New before the 0.7.16 cut. Measured 07:57 and again 14:05: the only voice check on main
(docs/browser-checks/render-voice-4409.js) uses stand-ins that record what the page asked for; nothing has played or
captured sound, and nobody has reported hearing it (speaker, or the Mac app's mic).

## Change
web/whats-new.json: drop the "Talk to your agents" highlight; the other four stay as written. Voice itself stays in the
build (#4536); only the announcement waits. The 0.7.16 versions entry drops its voice sentence at pre-flight.

## Checks
- node tools/whats-new-check.js 0.7.16 web/whats-new.json: 4 highlight(s), rc 0 (the cut's step 1b-ii).
- No test asserts the voice highlight's text (grep outside .claude: 0 hits) or a fixed highlight count.

## Weakest premise
An unannounced feature is still found by people, so leaving it out hides nothing; it only stops us announcing
something nobody has heard. Reversible: the next cut announces it once someone hears it. If someone reports hearing
it before the cut freezes, close this PR instead.
