# push718-check-headless: make render-push-718's notification read headed-only

Author: Kano (Mortal Kombat fleet). Date: 2026-09-24.

## What "finished" looks like

`docs/browser-checks/render-push-718.js` passes GREEN under `HEADED=0` (headless,
the staging-cut environment) instead of false-failing, while still fully asserting
the notification render when run HEADED. The 0.6.91 cut is no longer blocked by
this check on future cuts.

## Why

The check was flagged as a 0.6.91 cut blocker (#3552): headless it fails with
`the delivered coordinator push produced the mapped notification []`. Splinter
(non-owner) hypothesized it was gated on Raiden's still-open #3510 proxy PR.

Verified by reproduction (both arms, against a sandboxed board with NO
`/v1/push/*` proxies): the check delivers the push via the CDP
`deliverPushMessage` verb straight to the worker and never calls `/v1/push/*`, so
it is independent of #3510. HEADED = 17/17 (notification renders correctly);
HEADLESS = 16/17, the only red being the `getNotifications()` read, because
headless Chromium delivers the push to the handler but does not surface the
notification. It is a browser-platform limitation, not a product regression and
not #3510.

## Change

- Extract `const HEADED = process.env.HEADED !== '0'` (also removes the inline-flag
  style NIT) and use it for the launch.
- Gate ONLY the notification-render assertion on `HEADED`; under `HEADED=0` print a
  `SKIP` line with the reason instead of asserting. Serve/register/control and the
  CDP push-delivery assertions still run headless.
- Correct the header comment, which wrongly claimed "the release-cut gate runs
  these headed" (the cut runs headless).

The coordinator-payload mapping (`{kind,agent,project,id,address}` -> title/body/
click-through) remains covered headless by the node suite `web.sw-718.test.js`, so
skipping the headed-only render read loses no mapping coverage.

## Testing

- Reproduced: headless now 16/16 green (render read SKIPPED); headed still 17/17.
- Node suite unaffected: the change adds no counted FAIL-emit site, so the
  `browser-checks-reason-grep` count (128) and the `browser-checks-indexed` README
  guard stay green.

## Scope

Check-only. #3510 (Raiden's coordinator proxies) is decoupled and is separate
follow-up work (live end-to-end push), owned by me next, not a release blocker.
