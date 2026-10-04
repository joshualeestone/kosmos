# #4318: Federation calls gate on enrollment plus project link, independent of Remote access

## Problem
In Settings under Kosmos Plus, when Remote access is turned off, the off-state copy previously claimed:
"Plus is off, so no device can reach Kosmos on this computer right now. Your devices are kept for when you turn it back on."
This gave the false impression that turning off Remote access acted as a master privacy switch that stopped all authenticated outbound traffic. In reality, linked shared projects (federation) continue their edge checks and seats because federation gates on enrollment (deps.enrolled()) and the explicit per-project link record, independent of whether Remote access (remote.read().on) is active.

## Ruling (Pigeon Pete for Splinter, kosmos#4318 comment 2)
- Enrollment plus the per-project link is the durable consent for federation, independent of Remote access.
- Pin this independence with a test in engine/fedseats.test.js and doctrine comment in engine/fedseats.js.
- Update the off-state copy in web/index.html to:
  "Remote access is off, so no device can reach Kosmos on this computer right now. Your devices are kept for when you turn it back on. Shared projects and phone notifications stay connected."
- Update web.plus-reach-scope.test.js to assert the updated off-state wording and prevent regression to "Plus is off".

## Rejected
- Option 1 (Master switch): Stopping federation and phone notifications when Remote access is turned off silently breaks shared collaboration and notifications that the user configured separately.
- Option 3 (New Shared projects switch): Adds redundant control complexity for a consent that the project link already records.

## Changes
1. engine/fedseats.js:
   - Added doctrine comment documenting that federation seats gate on deps.enrolled() and project link, independent of remote.read().on.
2. engine/fedseats.test.js:
   - Added #4318: federation seats gate on enrollment and project link, independent of Remote access pinning that an enrolled board seats linked shared projects when Remote access is off, and does not when not enrolled.
3. web/index.html:
   - Updated id="plus-devices-off" copy to start with "Remote access is off" and disclose that shared projects and phone notifications stay connected.
4. web.plus-reach-scope.test.js:
   - Asserted that plus-devices-off starts with "Remote access is off", states shared projects and phone notifications stay connected, and excludes "Plus is off". Added control test.

## Verification
- Syntax check passed on all modified files (node -c).
- Pre-challenge proof recorded with matching diff hash.
- Zero em dashes across all code, tests, and documentation.
- Marked Tuesday-ready per release freeze policy.
