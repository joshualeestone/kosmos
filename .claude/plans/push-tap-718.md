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
