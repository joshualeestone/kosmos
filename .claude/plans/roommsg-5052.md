# roommsg-5052: render-room-msgbox-2806's seam sample no longer reads the message's text

Card #5052 (comment 5960043542 has the measurement).

## Measured
The "no double-tint seam" pixel check samples box.right-14..+14, box.bottom-22..+3 around the user bubble's tail.
That window reaches into the message's timestamp (`.mwhen`). The probe, run on both platforms:
- Linux: the bluest pixel is at (681, 59), dx -14 / dy -13, on `.mwhen`, rgb(98,147,210) (glyph ink): lead 63 vs
  body 10, FAIL.
- Mac: the same pixel on `.mwhen`, rgb(226,229,240) (between glyphs): 11 vs 10, PASS.
The tint is rgb(232,235,245) on both, and there is no seam on either. The timestamp is now(), so a Mac could also put
ink there at some times of day: a latent flake.

## Change
docs/browser-checks/render-room-msgbox-2806.js: the sampled bubble's host gets `-webkit-text-fill-color: transparent`
(glyph ink only; geometry, the tint and the tail, which paints `background-color: inherit`, are unchanged).

## Verification
- Mac: the check passes (seam 11 vs 10).
- Linux (run 37055723423, font pinned as the #4601 Linux job does): the whole check passes.
- CONTROL, Mac: `--usermsg-tint` made translucent again (the regression this oracle exists for) still fails it
  with text hidden (body 29, wing 52).
- Follow-up after merge: remove render-room-msgbox-2806 from tools/bc-macos-only.txt (#4601), 9 of the 11 macOS
  routings in #4601's 40-commit sample.

## Iterations
(filled in by the review loop)
