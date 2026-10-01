# touchicon-4798: the phone home-screen icon fills its tile (no black frame)

Card: kosmos#4798 (Josh, 2026-09-30 17:53).

Finished looks like: "Add to Home Screen" on an iPhone shows the gold K filling the whole tile with no dark frame;
Android's saved icon has no ring. Served in a build.

Cause: web/index.html's apple-touch-icon was kosmos-180.png, the Mac icon (rounded, in a transparent margin). iOS
fills transparency with black, then rounds the icon itself.

Decisions:
- Source: assets/Kosmos-1024.png, the full-bleed opaque square (identical to the iPhone app's AppIcon.png,
  measured max pixel difference 0). No new artwork.
- New files, not a replacement: kosmos-180.png is also the Dock row's picture (web/index.html, the "put it in your
  Dock" row), which must stay Mac-shaped. So: kosmos-touch-180 (apple-touch-icon), kosmos-maskable-192/512
  (manifest, purpose maskable). The "any" icons are unchanged.
- Only 180 for iOS (iPhone uses 180; iPads scale it). 167/152 not added.
- server.js: the /icons allowlist gains the three names (an unlisted name 404s).
- login.kosmosplus.com declares no touch icon; nothing to change there.
Weakest premise: only a real phone shows "no frame". A home-screen icon is captured when it is added, so anyone
who saved Kosmos before this must remove and re-add it.
