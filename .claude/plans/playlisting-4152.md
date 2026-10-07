# Plan: Play listing graphics update to Mona's delivered assets (#4152)

## Goal / Done when
`docs/play-listing.md` describes the assets Mona Lisa actually delivered: five
1080x1920 phone screenshots (in upload order), a 1024x500 feature graphic, and a
512x512 icon, each with alt text written from reading the image. The in-repo copies
under `docs/play-listing/` match the doc (paths, dimensions, sha256). The doc previously
described two 800x1600 screenshots and a six-shot mixed-dimension set; that is replaced.

## Why graphics are committed here
#4152 already keeps the Play graphics in the repo (`docs/play-listing/` held the prior
icon, feature graphic, and `phone/` set, with sha256 in the doc). So per the task's rule
("graphics stay out of the repo unless #4152 already keeps them there"), the new assets
replace the old committed ones, and the doc's hashes are recomputed to match.

## What changed
- Checklist: "two 800 by 1600 phone screenshots" -> "five 1080 by 1920".
- Graphic-assets table: the six old phone rows replaced by five (01-home, 02-agent-chat,
  03-push-landing, 04-project-room, 05-agents-list), all 1080 by 1920; icon and feature
  graphic re-pointed at Mona's files; every sha256 recomputed from the committed bytes.
- Provenance paragraph rewritten: the five are board renders from the app code shipped as
  0.7.27 (tag `archive/0.7.27-app-commit`), shot with the sanctioned screenshot tool
  (throwaway board, clean demo fleet, leak guard passed) in Chromium; no account data. The
  icon/feature provenance follows Mona's README (installkosmos.com look, Josh's social-card words).
- Alt text: five lines, each written by reading the image, describing the caption and what
  is on the screen.
- `docs/play-listing/`: old icon/feature replaced; old `phone/01..06` removed; new
  `phone/01-home..05-agents-list` added.

## Verification
- `sips` confirms the five screenshots are 1080x1920, feature 1024x500, icon 512x512.
- Each doc sha256 recomputed from the committed file (shasum -a 256).
- No em dashes anywhere in the doc.

## Scope / non-goals
- Docs + committed-asset update only; no code change.
- The 4096x2304 developer-page header in play-assets/ is a developer-page asset, not part
  of this store-listing doc, so it is out of scope (noted in the PR).
- The "Sources checked" AVD-evidence reference stays (it names evidence that exists and was
  consulted; it is not a claim about the new screenshots).
