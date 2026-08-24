# plus-tab: the Plus Account Settings tab, a holding place first

## What finished looks like (Josh, 19:15 and 19:18: first pass, he reacts)

A Settings tab "Plus Account" before Advanced. Its RESTING state is the
holding place, his word: a real explanation of what Plus is (use your
Kosmos from anywhere, phone notifications, everything stays on the Mac,
end-to-end encrypted) and the honest sentence that sign-up is not open
yet. NO controls in that state: sign-up cannot complete before DNS and
certificates exist, and a working-looking button that cannot work breaks
the no-dead-buttons rule. No hostname and no price anywhere in the copy:
the domain is explicitly temporary and pricing is not ruled.

Beneath it, the REAL flow, gated on this machine actually having a relay
configured (the engine's env/stored seam): the switch driving
engine/remote.js's setOn/ensure, the honest status line (off, connecting,
up with the address, restarting, each with its because), and the
email-then-code enrolment steps driving setupStart/setupComplete. The day
the service opens, the tab starts working without a rebuild.

Four thin routes over the merged #464 engine: GET /api/remote (status,
configured, enrolled), PUT /api/remote (the switch), POST
/api/remote/setup-start (email validated before anything spawns), POST
/api/remote/setup-complete. The tab paints on arrival, never on the poll.

## Tests

web.plus-tab.test.js: the holding place has no controls, the flow starts
hidden, no hostname or price in the copy, the configured gate and the
arrival paint pinned from source. server.test.js: unconfigured honesty,
the env-seam configured flip, the switch round-trip, the pre-spawn email
refusal. web.settings-nav.test.js and render-settings-nav.js updated for
the eighth section; the browser check drives it in both themes, and a
headed capture shows the resting state Josh will react to.

## Review bound

Two rounds maximum, stopping rule standing: findings only in a round's
own fixes mean ship.
