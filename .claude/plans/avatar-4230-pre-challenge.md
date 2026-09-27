---
pre_challenge: true
method: challenge-loop
branch: avatar-4230
diff_hash: 3b00d331283eeef006eacfbc6d032c03ffcd1e3ebe669c012afbae1f0ce10c73
subdir_audit: passed
timestamp: 2026-09-27T18:36:53Z
converged: true
---

## Challenge loop: #4230 the setup guide wears Josh's new photo

#### Iteration 1 (blind, sonnet)
NO NEW FINDINGS. Checked:
- The refresh only replaces a picture byte-for-byte equal to a retired bundled photo. It uses the same
  guideName() + isGuideFolder pair the server already uses to authorise the guide folder (server.js ~3648).
- RETIRED_GUIDE_AVATARS matches origin/main's old file: sha256 13237cdb... measured.
- The new image is 400x400 JPEG and is not itself retired (pinned by a test).
- store.saveAvatar unlinks the old extension before writing, so no stale .png/.jpg is left beside it.
- setImmediate in listening, try/catch, idempotent; safe across repeated start() in tests.
- The tests are hermetic (sandboxed roots set before require). No em dash.

#### Iteration 2
Not run: iteration 1 found nothing.

## Evidence
- engine.setup-assistant-3034: 42/42. With the swap line removed, the "retired photo gets the current one" test FAILS
  (control).
- render-assistant-hosted-3660 on the branch: all 107 pass; its screenshot shows the new photo in the guide's panel
  at real size (about 34px): cap, glasses and face readable.
- Crop chosen from three, previewed as circles at 46, 34 and 28px (Josh: "feel free to crop in tighter").
- Full suite 10788 pass, 0 fail, exit 0. #1720 (trailer) and #2518 gates pass.
