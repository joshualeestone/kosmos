# #5354: the app's Kosmos+ sign-in says a long wait in minutes

## The report
Live 2026-10-05: a new Kosmos+ user's sign-in said "you can ask for another in 1290 seconds" and counted down from it.

## Split with Kitty (Splinter 19:18)
Kitty's kosmos-relay codecap-verified rewords the RELAY's own sign-in page (signin.html) from retry_after_secs and keeps
the server's sentence in seconds on purpose, under test (the_sentence_always_carries_the_seconds_the_app_matches),
because the app matches it. This card is the APP's own sign-in screen (web/index.html plusCountdown). Same words.

## Change
plusWaitWords(secs), the relay's waitWords exactly: under 120 s, "N second(s)"; else "about N minutes", rounded up;
"about an hour" at sixty. plusCountdown paints the coordinator's sentence with it, every second, so a long wait reads in
minutes and drops to a seconds countdown under two minutes.

## Not done, and why
The card asks to read retry_after_secs rather than the sentence. It does not reach this page: the sign-in runs through
the setup tool (engine/remote.js signinStart -> setupRun), which hands back only the sentence. The seconds in that
sentence are pinned by the relay's own test, and Kitty is told the app depends on them. Plumbing retry_after_secs
through the tool is a relay change for later, not needed for the words.

## Tests
web.plus-wait-5354.test.js: the words at 1, 59, 119 (CONTROL), 120, 121, 1290, 3540, 3600; the live sentence reads
"about 22 minutes" and counts down in seconds under two minutes. Reverting the paint reds it. web.plus-wizard-3796,
web.code-box and web.plus-stale still pass.

## Weakest premise
That the coordinator's sentence keeps "in N seconds". If it changed, the app would show the refusal without a countdown
(its existing fallback), not a wrong number.
