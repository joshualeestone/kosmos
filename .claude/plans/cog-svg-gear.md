# cog-svg-gear: draw the notification cog as an inline SVG path, not the U+2699 glyph

## Goal (Josh, 2026-09-09 7.59.01, "you guys are killing me on this cog")
The first-run "App Background Activity" notification mock (s4-notif) shows a gear in a gray icon box. It has read high-and-left in that box for 5-6 builds (#768-batch, #2460). ROOT CAUSE, confirmed from Josh's on-device screenshot: the gear was the U+2699 GLYPH (`&#9881;`), and a font character carries its own asymmetric side/vertical bearings. No box-centring (place-items, flex, line-height) can fix a glyph's bearings, so every attempt regressed. It looked centered ONLY in headless Chrome, whose fallback glyph has different bearings than macOS's system font, which is why the regression was never caught.

## Change (web/index.html, s4-gear)
- Replace `<span class="s4-gear">&#9881;</span>` with an inline `<svg viewBox="0 0 32 32">` gear PATH (8-tooth cog + center hole, fill #3a3a3c). The path is symmetric about the viewBox centre, so it centres by its own geometry regardless of the rendering engine or font.
- `.s4-gear` box: `display:grid;place-items:center;padding:11px` (the svg fills the padded 30px content area, so the ~30px gear sits centred in the 52px box, matching the size Josh approved). Added `.s4-gear svg{width:100%;height:100%;display:block}`.
- Updated the CSS comment to record the root cause and "do NOT revert to the glyph".

## Why SVG, not a PNG (Josh offered a PNG)
A vector path centres by construction, scales crisply at any size, and needs no image asset. It fixes the exact defect (font bearings) without a binary file. If Josh still wants a PNG, it is a one-line swap, but the vector is the better durable fix.

## Done when
The gear is centred (both axes) in the gray box on real macOS, verified by render with a centre crosshair. No U+2699 glyph remains. Ships 6.51 (a follow-up to the 6.50 cut, not a blocker for it).
