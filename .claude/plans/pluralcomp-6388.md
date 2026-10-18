# pluralcomp-6388: two computers waiting are "2 of your computers", not "2 devices"

Card: joshualeestone/kosmos#6388 (multi-computer setup audit).

## Finished looks like
With two or more of the person's own computers waiting to join and nothing else, the compact notice off the Kosmos+
page reads "N of your computers want to join." Any mix with a phone or browser keeps "N devices want to connect to
your Kosmos." A browser check asserts both (the existing computer-plus-phone arm is the control).

## Steps
1. web/index.html paintAsk notice line: `fresh.every((d) => d.joining_computer)` picks the computers wording.
2. docs/browser-checks/render-connect-sheet-4637.js: a two-computers arm beside the one-computer arm.
3. Both browser-check gates, the connect-sheet check, challenge loop, PR, merge on green.
