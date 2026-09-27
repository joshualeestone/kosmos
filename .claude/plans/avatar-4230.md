# #4230: the setup guide wears Josh's new photo (2026-09-27)

## Finished looks like
web/icons/setup-guide-avatar.jpg is Josh's new photo, 400x400 JPEG, cropped tighter than the old one (his ask: "feel
free to crop in tighter"): face and cap fill the circle, chin to cap brim comfortably inside, readable at 34px. The
hosted guide's bubble shows it (render-assistant-hosted-3660 passes, 107). An existing guide agent still wearing the
old bundled photo gets the new one on start; a picture the person chose is never touched.

## Decided
- Crop t3 (tightest of three): 1254px source, square from (130,146) side 919, resized to 400 (Lanczos), JPEG q88.
  Previewed as circles at 46, 34 and 28px; t3 keeps the face readable smallest. The cap crown clips at the top; chin
  to brim stays inside.
- No flip (Josh's file is already flipped).
- Existing guides: refreshGuideAvatar on board start replaces the guide's picture only when it is byte-for-byte a
  retired bundled photo (RETIRED_GUIDE_AVATARS: the old file's sha256). Best-effort; any failure leaves it.
- Windows ships the same web/ and server.js, so it gets the same file; the website and relay do not use it.
- Weakest premise: the refresh runs once per board start; a guide whose picture differs from the retired one by even
  a byte (re-encoded) keeps it. That is the safe side.
