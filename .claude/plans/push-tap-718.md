# Plan: a web push tap opens the agent (kosmos #718, mobile pass)

Pair of kosmos-relay push-session-718 (the coordinator passes a validated `session`).
Shape agreed with Johnny (iOS) and Liu Kang: https://<address>/?tab=detail&agent=<session>,
the board's own link (syncUrl writes it, WANT_AGENT reads it at boot, openDetail matches
by sessionName). A link to an agent that is not on the board goes to the board home (Part 2).

## Finished looks like
- web/sw.js boardUrlFor adds ?tab=detail&agent=<session> only when session matches
  ^[a-z0-9][a-z0-9_-]{0,63}$, via URLSearchParams; anything else keeps today's URL.
- Tests: the good links (with and without address), the notification carries it, and every
  trick is dropped. Control: removing the regex check turns the hostile test red (measured).
- The Android TWA uses this service worker, so Android lands the same way.

## Decisions
- Re-check on the phone even though the coordinator checks: the service worker must not
  trust a push. Same rule as the coordinator and the iOS app, one shape everywhere.
- Weakest part: a found agent with a non-conforming session name gets no deep link.

## Part 2: where the tap lands on a phone
A tap opens ?tab=detail&agent=<session>, but on a phone the agent page stacks (max-width
56rem): identity, five full-width section boxes and Files come first, so the question sat
about two screens down on an iPhone SE. detailRevealTalkOnPhone scrolls the Direct Message
section into view on the two ARRIVALS, only when the stacked layout is on:
- the push link at boot: SETTLED ONCE on the first status (the boot open sits in the poll,
  which runs every few seconds; review iteration 1 caught the reveal re-running there). If
  the agent opened, reveal; if it is not on the board (a push for an agent removed since),
  go to the board home instead of the empty agent page the link used to leave, and stop
  reopening it.
- the Answer button: it already put the question on screen (it focuses the composer); the
  reveal is a belt-and-braces call before that focus, re-measured with it in place.
Measured, sandboxed board, Chromium and WebKit (engine build, not Safari), SE:
push link: question off screen (scrollY 0, top 1036) -> fully on screen; Answer: on screen
before and after; a link to a missing agent: stuck on an empty agent page -> the board home;
scrolled back to the top after landing and waited 7s: stays put (no re-pull).
Tests: web.push-landing-718.test.js pins the one-shot settle, the fallback home, the Answer
call site, the shared 56rem breakpoint, and the behaviour (phone scrolls, computer does not,
hidden/missing section left alone).
Control: dropping the boot call fails it.
Not touched: the Direct Message layout itself (Scorpion's screen).

## Part 3: the other "waiting on you" controls, at thumb size
- The Allow card (#askcard, a phone asking to use this Kosmos): its 3px gold LEFT BAR is
  now a 1px gold border all round (Josh, 2026-09-24: no solid coloured left bars on cards;
  same attention, same gold token). On a touchscreen its buttons are 44px tall (were 34
  and 24). Measured at all 4 sizes x 2 themes x 2 engines (the card is injected at
  /api/remote/pending in the audit; a sandbox has no tunnel): no left bar, 44px buttons,
  no horizontal scroll. Test pins it; control (bar restored) fails it.
- "Answer" on a needs-you card: a larger invisible hit area on a touchscreen (about 40px
  tall, inset -8px -6px so it does not reach the next row in the list layout), the pill
  layout unchanged.
