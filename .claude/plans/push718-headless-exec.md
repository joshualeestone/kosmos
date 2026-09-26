# push718-headless-exec (#3565)

## Problem
`docs/browser-checks/render-push-718.js` asserted the push handler's result only by
reading `getNotifications()`, which is headed-only. Headless (the staging-cut gate) it
asserted only that the CDP send did not throw, so a push handler that threw, or never
called `showNotification`, passed every automated run.

## Measured before choosing (2026-09-24, sandboxed board, Playwright chromium)
| | headless | headed |
|---|---|---|
| handler calls showNotification with the mapped notification | yes | yes |
| `Notification.permission` after origin-scoped grantPermissions | denied | granted |
| showNotification | rejects (permission) | resolves |
| getNotifications() | [] | the notification |

So the headless limit is the permission, and the handler's execution IS observable headless.

## Change (card option 2)
- In the check, just before delivering the push, wrap `self.registration.showNotification`
  inside the live worker (Playwright `ctx.serviceWorkers()` + `evaluate`). The wrapper
  records the title, body and click-through URL the real handler passed and how the call
  settled. It is test-side only; nothing is added to the shipped `sw.js`.
- Two new arms in both modes: the handler made exactly one call, with the mapped
  notification; and it settled as the mode allows (headed: resolved; headless: only the
  permission rejection, and only while the page reads `denied`).
- The headed render read and its SKIP stay; the comments and README now give the
  measured cause.

## Rejected
- Option 1, a headed lane in the cut: needs a console session on the cut box, and it
  still leaves every headless run blind to the handler.
- A signal emitted by `sw.js` for tests: a production hook the card rules out.

## Weakest premise
That the worker is not restarted between the wrapper and the delivery. If it is, the
wrapper is lost, the arm reads "no call" and goes red (a false red, never a false pass).
Three consecutive headless runs were stable.

## Proof
- Headless 18/18 three times; headed 19/19 (render read plus both new arms).
- Control: a `throw` injected at the top of the served `sw.js` push handler turns both new
  arms red headless (16/18), while "a push was delivered" still passes, which is the gap.
- Guard tests green: browser-checks-reason-grep, server.sw-718, web.sw-718,
  browser-checks-selectors, fixture-discipline.
