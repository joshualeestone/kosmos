# certlocal-6986: the certificate check's off switch and lost-report Got it refuse a remote session

Card: #6986. Base: origin/main a752cc44f3.

## Scope
- `PUT /api/remote/cert-watch`: a request that came through a forwarder (Kosmos+ remote access) and does not say
  `on: true` is refused with 403 `remote_not_allowed` (REMOTE_NOT_ALLOWED.certWatchOff), before the screen check.
  Switching the check ON from a remote session stays allowed: it only adds protection.
- `POST /api/remote/cert-watch/ack-lost`: a forwarded request is refused first (REMOTE_NOT_ALLOWED.certWatchAck).
- The page already shows the server's sentence on a refused change (plusSay of the error), so no page change.

## Tests
server.test.js "certificate check" route test: forwarded off and 'no' refused (both forwarder header shapes), file
untouched; forwarded ON allowed; forwarded Got it refused and the loss still said; local paths unchanged. Three mutants
(each refusal removed; ON refused too) each go red.

## Not in scope
- The stronger "made on this computer with the board's cookie" gate is for the new branch-c routes (#6590); these two
  use #6595's isRemoteRequest, as Allow does.

## Weakest premise
isRemoteRequest reads forwarder headers. A request with none of them is local by that rule, the same boundary every
#6595 route relies on.

## Review 1 (blind, 07:53 CDT): 0 BLOCKER, 0 WARNING, 3 NIT
- An unreadable remote change answered 400 "could not read" --> FIXED (403 remote_not_allowed from the parse's catch)
- The bare `Forwarded:` header was untested --> FIXED (test arm)
- The page explains only after a press (a remote viewer sees a live switch and gets the server's sentence) --> DECIDED,
  kept: the same as #6595's Allow today; the page already shows the refusal as said. Not hiding controls remotely
  keeps this change server-only.
