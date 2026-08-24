# index-openai-check: name render-accounts-openai.js in the browser-checks README

## Finished looks like
browser-checks-indexed.test.js passes on main: render-accounts-openai.js
(present since #606) is named in docs/browser-checks/README.md.

## Why
The check exists but was never indexed, so the guard test reds on main for the
whole fleet, blocking every release gate on demo day. #606 and #607 both
merged green and left main red (the deeper gate gap is #612).

## Changes
One table row in docs/browser-checks/README.md, with an accurate header
sentence. Nothing else in docs/browser-checks (Ice Cream Kitty is mid-#545 in
that folder; a broader edit would collide).

## Not in this change
Any tidy-up of the README's other no-header-sentence rows; the gate fix (#612).
