# token-acl-decision-2040: record the ratified Windows token ACL decision (#2040)

## Decision (ratified by Splinter 2026-09-06)
Accept NTFS inheritance for the Windows board token; do NOT add an explicit icacls
owner-only ACL. The token lives under %APPDATA%\AgentWorkforce (profile-private:
inherited ACL = SYSTEM + Administrators + owner, no Users/Everyone), which already
excludes non-admin other accounts - the Windows analog of the macOS 0600 boundary by
LOCATION. An explicit ACL removing Administrators is cosmetic (admin bypasses any DACL);
removing SYSTEM risks the service.

## Change
Comment-only docblock update in engine/boardauth.js (no behavior change). Records the
decision, keeps the file-MODE boundary (absent on win32) distinct from the LOCATION
boundary (present), corrects a mild exposure overstatement ("another local account can
read it"), and names the weakest premise (holds only while the root stays
profile-private; store.dataroot-570.test.js pins that precondition).

## Verification
The comment+test halves of #2040 were already merged (ownerOnlyModeIsEnforced +
boardauth-1946.test.js). Blind accuracy review verified every factual claim. Full suite
green. No new tests needed (the platform branch + the profile-root precondition are both
already tested).
