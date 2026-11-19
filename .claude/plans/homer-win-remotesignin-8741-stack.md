# #8741 change 2: a remote-started sign-in sets noOpener on Windows too

**Posture:** production

## Done when
1. On Windows, `connect.start({ remoteStarted: true })` sets `noOpener` on the flow and on the host launch, so the page says "Open the Claude sign-in page" with the printed code-paste link (connect-level test).
2. A remote start on Windows opens no page and a local start still opens one (connect.win32signin test with a control; each fails with the fix reverted).
3. CI green, including the windows job.

## Decided
- Change 1 (PR #8744, merged 5e77d5309a) made the Windows sign-in host honour `launch.noOpener`. #8728 slice 1 (PR #8747, merged 25c60b657d) carries `remoteStarted -> owner.noOpener -> launch.noOpener / state.noOpener` but left Windows out, because the Windows host still opened a tab then. This change drops that exclusion.
- #8728's review-5 test "on Windows a remote start does not claim that no browser opens" is flipped to assert `noOpener === true`; posted on #8741 for Renet before building.
- Rebased from Renet's branch onto main after #8747 merged; the change is line-for-line identical to the reviewed df408f53d2.
- Weakest part: a full sign-in finished from a phone has not been run live; it rests on the unchanged paste path (`sendCode`). Would change my mind: a live phone run where the pasted code is refused.
- Rejected: keeping the Windows exclusion and changing only the page wording (the page would then tell a remote person nothing opened while the host still opens a tab).

## Review round 1 (blind, 0 BLOCKER, 0 WARNING, 3 NIT)
Reviewed together with change 1, as the two stacked commits. Findings and their dispositions are on homer-win-remotesignin-8741.md (merged with #8744) and in this branch's proof file.
