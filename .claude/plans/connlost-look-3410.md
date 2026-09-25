# Plan: #3410 follow-up, Mona Lisa's wording and the given-up look

## Finished looks like
A card whose agent lost its connection says "Kosmos will try again for you." while Kosmos is
reconnecting, and, once Kosmos gives up, "Kosmos tried a few times and stopped. If your internet
is working, restart the agent. It starts fresh, so anything it was in the middle of is lost." on
the needs-you card (red border, st-attn), not the grey paused one. Reconnecting keeps the paused
look. With the self-heal off, nothing changes.

## Why
Mona Lisa's wording review of #3712 on the card (2026-09-25 11:12Z): two lines change, and given
up needs the person, so it should look like it. Angel makes the edit (agreed in thread).

## Change
- web/index.html stateReason: Mona's two sentences, verbatim.
- web/index.html cardStOf: connection_lost with reconnect.phase 'gave_up' returns CARD_ST.needs_you.
  cardStOf is the only reader of CARD_ST (19 callers, grep today), so card, row and detail agree.
- Tests: web.connection-lost-3410.test.js pins the sentences and the look per phase (control: no
  self-heal stays paused). The browser check asserts the card class and the computed border colour
  per phase on the live page.

## Checked
- Mona's weakest premise: a restart loses work in progress for every runner. No launch line on
  main passes a resume or continue flag (Claude, Codex, Gemini, Grok, Antigravity), so the clause
  stays.
- Red controls: without the cardStOf change the unit test fails 1 and the browser check fails 2
  (class and border).

## Rejected
- Giving the heal-off case the needs-you look too: Mona's review left that case as it is, and
  without the self-heal Kosmos cannot tell a drop that will clear from one that will not.

## Weakest premise
That "needs you" red is right while the internet is genuinely still down (the give-up can happen
during a long outage). The sentence covers it ("If your internet is working").
