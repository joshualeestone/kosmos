# Screenshots for Kano's #718 mobile PRs (never merged)

Contact sheets only, linked from the PR bodies. This branch has no code and is not meant to
merge. Each sheet is one screen in one engine: BEFORE (origin/main) above AFTER (the PR
branch), light and dark rows, iPhone SE 375x667, iPhone 15 393x852, Pro Max 430x932 and
Android 412x915 left to right.

Shot with the fleet's shared harness (docs/browser-checks/mobile-shots.js, Raiden, origin
mobile-shots at d2f47445 or later) so every agent's screens are measured the same way. It
boots a THROWAWAY sandboxed board with sample data (fixture agents and projects), never a live
board, with AGENT_WORKFORCE_HOME sandboxed and dry-run on, and a leak guard that stops the run
with no further shots if any screen shows real data (kosmos#3675). Each folder carries the
harness's before and after reports (overflow flags per shot).

WebKit here is Playwright's WebKit build, an engine approximation, not Safari. Chromium at a
phone size is not an Android phone.

- push-tap-718/ : the "waiting on you" board screen (ask-waiting).
- mobile-rooms-718/ : the project room and the projects list.
