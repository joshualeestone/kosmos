# Plan: Play listing graphics update (#4152)

## Scope (settled after a mid-work correction)
Update `docs/play-listing.md` and the in-repo graphics under `docs/play-listing/` to Mona
Lisa's delivered store assets: a 512x512 icon, a 1024x500 feature graphic, and THREE
1080x1920 phone screenshots showing the Kosmos+ phone layout the Android app opens (navy
Kosmos+ bar, agents as a list, demo data only). An earlier five-shot set showed the board's
computer layout and was discarded (Liu Kang; the wrong copies live in `*-WRONG-LAYOUT`
folders and must never be used). A fourth screenshot (project room) is pending #5510 and is
noted as a follow-up, not committed here.

## Done when
The doc's Graphic-assets table lists the icon, feature graphic, and three screenshots with
sha256 matching the committed bytes and dimensions verified; each screenshot has alt text
written from reading the image; the checklist and provenance agree; the fourth screenshot is
noted pending #5510; no em dashes; the committed `docs/play-listing/phone/` holds exactly the
three corrected screenshots.

## What changed vs origin/main
- Icon + feature graphic replaced with Mona's (sha256 recomputed from the committed bytes).
- `docs/play-listing/phone/`: the old origin/main six screenshots removed; the three
  corrected ones added (01-home, 02-agent-chat, 03-push-landing), all 1080x1920.
- Doc: table rows for the three; provenance recast (navy Kosmos+ phone layout, demo data, no
  account data) with the pending-fourth note; three alt-text lines read from the images;
  checklist line updated; "Sources checked" AVD line de-ambiguated.

## Verification
- `sips`: icon 512x512, feature 1024x500, each screenshot 1080x1920. Each doc sha256
  recomputed from the committed file. No em dashes. No references to the wrong/old set.

## Follow-up (not this PR)
- When #5510 ships and Mona delivers the project-room screenshot, add it under
  `docs/play-listing/phone/` as Phone screenshot 4, add its table row (file/dims/sha256) in
  upload order, and write alt text read from the image.
