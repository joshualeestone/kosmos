# #8741: a remote-started Claude sign-in opens no tab on the Windows computer

**Posture:** production

## Done when
1. A sign-in started remotely on Windows opens no page on that computer (unit test + live check on the Windows box with a real `claude auth login`).
2. A local start still opens the page once (control, unit + live).
3. The page still offers the printed manual link (redirect to platform.claude.com, shows a code), so the sign-in finishes from the person's own device by pasting the code.

## Decided
- Change 1 (this branch, on main): `win32signin` `open()` takes `launch.noOpener` and then never calls `openSigninPageOnce`. Default unchanged, so it is safe alone; no caller sets it until change 2.
- Change 2 (branch homer-win-remotesignin-8741-stack, on Renet's remoteopener-8728): `start()` drops the win32 exclusion in `remoteStarted`, so connect passes `noOpener` and the page shows "Open the Claude sign-in page". It flips #8728's review-5 test "never on Windows". PR after #8728 merges, rebased onto main.
- Rejected: rewriting the page's link to localhost for remote starts (a localhost callback cannot work on the person's phone) and keeping the Windows opener but pointing it at the manual link (it still puts a tab on a screen nobody watches, and a press of Authorize there signs in whatever account that browser holds).
- Weakest part: a full sign-in actually finished from a phone has not been run live; it rests on the existing, unchanged paste path (`sendCode`), which connect.win32signin tests already cover. Would change my mind: a live phone run where the pasted code is refused.

## Review round 1 (blind, 0 BLOCKER, 0 WARNING, 3 NIT)
- NIT: the negative unit check sleeps 100 ms; kept, because it also asserts the port was never looked up, which catches a delayed open.
- NIT: a remote viewer joining a flow started locally sees "your browser has opened" (pre-existing in #8728, all platforms, cosmetic: the fallback link and paste still work). For a separate card.
- NIT: "missing newline at end of file" was checked and is not so (the file ends with a newline, as on main).
