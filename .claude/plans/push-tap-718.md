# Plan: a web push tap opens the agent (kosmos #718, mobile pass)

Pair of kosmos-relay push-session-718 (the coordinator passes a validated `session`).
Shape agreed with Johnny (iOS) and Liu Kang: https://<address>/?tab=detail&agent=<session>,
the board's own link (syncUrl writes it, WANT_AGENT reads it at boot, openDetail matches
by sessionName and returns quietly if the agent is gone, leaving the board home).

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
section into view on the two ARRIVALS (the push link at boot, and the Answer button), only
when the stacked layout is on.
Measured, sandboxed board, Chromium and WebKit (engine build, not Safari), SE and Pro Max:
push link question top 1036/998 -> 127, composer off -> on screen. The Answer button was
already fine (it focuses the composer) and is unchanged.
Tests: web.push-landing-718.test.js pins both call sites, the shared 56rem breakpoint, and
the behaviour (phone scrolls, computer does not, hidden/missing section left alone).
Control: dropping the boot call fails it.
Not touched: the Direct Message layout itself (Scorpion's screen).
