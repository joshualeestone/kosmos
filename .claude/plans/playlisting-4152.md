# Plan: Play listing graphics update (#4152) — icon + feature now, screenshots pending

## Scope note (changed mid-work)
Liu Kang put a HOLD on the screenshot part: Mona Lisa's five phone screenshots showed the
board's COMPUTER layout, not the Kosmos+ PHONE layout the Android app actually opens, so she
is retaking them. This PR therefore updates the icon and feature graphic (which are fine) and
marks the phone-screenshot section as waiting on the corrected set. It commits NO phone
screenshots.

## Goal / Done when
`docs/play-listing.md` lists Mona's new 512x512 icon and 1024x500 feature graphic (with
sha256 matching the committed bytes), and the phone-screenshot section is a clear "waiting on
the corrected phone-layout set" placeholder with no screenshot rows, no alt text, and no
committed images under `docs/play-listing/phone/`.

## What changed
- Checklist: the screenshot upload line made pending ("Pending Mona's corrected phone-layout
  screenshots ...").
- Graphic-assets table: keeps the App icon and Feature graphic rows (Mona's new files, sha256
  recomputed from the committed bytes); the phone rows are removed.
- Provenance: icon + feature graphic only (installkosmos.com look, Josh's social-card words);
  a bold "Phone screenshots: waiting on the corrected set" paragraph explaining the earlier
  renders were the board's computer layout and must not be committed/uploaded.
- Alt text: the five screenshot alt lines removed (none until the corrected set).
- `docs/play-listing/`: icon + feature replaced with Mona's; ALL phone screenshots removed
  (the old origin/main six, and the five wrong-layout renders that were briefly committed) —
  `docs/play-listing/phone/` is empty.
- "Sources checked" AVD-evidence line de-ambiguated so it is not read as screenshot provenance.

## Verification
- `sips`: icon 512x512, feature 1024x500. Each doc sha256 recomputed from the committed file.
- No em dashes anywhere in the doc. No stale references to the removed screenshots/dimensions.

## Scope / non-goals
- Docs + committed-asset update only; no code.
- The 4096x2304 developer-page header is a developer-page asset, out of this store-listing doc.
- The corrected phone-layout screenshots are a FOLLOW-UP once Mona delivers (not this PR).
