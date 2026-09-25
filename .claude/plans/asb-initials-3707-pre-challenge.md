---
pre_challenge: true
method: challenge-loop
branch: asb-initials-3707
diff_hash: b8556320a1a790df4d894c07fad5e68b1788bbbe2c20db9549be971dec7c75e6
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T21:49:03Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2's one WARNING was decided against with the reason below; no code change followed)
**Fixed:** 1 WARNING | **Deferred:** 0 | **Asked (awaiting user):** 0 | **Decided against:** 1 WARNING

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING
**Self-generated:** 0
- [WARNING] asbAvatar hand-rolled a second renderer of "picture or initials on a disc", beside face(). Fixed: it wraps
  the board card's own face() markup as the image (one renderer), cropped to the disc.
Verified: escaping and encoding (esc() inside the SVG, encodeURIComponent of the whole, the # in the fills); the only
place these two images are set goes through asbAvatar; the hosted assistant never reaches it; no CSP blocks data:
images; busyRow already drew initials; B2 can fail against the old route.

After iteration 1, the first 6j caught the literal style element inside the SVG string (the stylesheet guard read it
as a second stylesheet): the font is now presentation attributes on a wrapping group. Rendered identically (seen).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING
**Self-generated:** 0
- [WARNING] The synthetic row passed to face() carries no `swarm` field, so a guide that were also a swarm would show a
  plain initial here while its card shows the cluster. DECIDED AGAINST: the guide is created as a plain agent (the
  seed), and swarmFaceSvg draws the cluster from members' picture URLs (/api/agent/.../avatar), which an SVG shown as an
  <img> cannot load, so forwarding the field would draw a cluster of broken images, the defect this card removes.
  What would change this: a guide that can be a swarm; then the bubble needs its own cluster, not an image.
Verified: esc() emits only XML-valid entities; the clip-id line runs safely on the synthetic row; the viewBox crops
face()'s 72-unit disc exactly (13 to 59); the group's font attributes inherit to face()'s text.

## Validation
6j on HEAD: full suite clean (hash b8556320a1a7), subdir audit clean. render-assistant-bubble-3034: 76 pass, B2 with
its control (a guide with a picture still gets the avatar route).
