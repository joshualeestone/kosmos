# whatsnew-0801: What's New for 0.8.01

Pool PR before the 0.8.01 staging cut. Prod check: `build` read prod 0.8.00, marked the highlights 0.8.00 showed as shown, and recorded lastProd 0.8.00.

## Changes to announce, by merged PR (since the 0.8.00 freeze e224150682, plus #8273 and #8274, which shipped in 0.8.00 and missed its notes)
| PR | change | pool |
|---|---|---|
| #8295 | #8286: a working agent on one tool call for 5 minutes says so | rank 11.2, in the window, mac: Windows reads no transcripts and only Claude agents have it; Linux loses the line because tagged items show only on their platform |
| #8306 | #8293: an added agent keeps its account and model | rank 11.4, in the window |
| #8296, #8311 | #8287, #8297: the restart note says what was checked | rank 11.6, in the window |
| #8313 | #8294: a warning before an agent runs twice | rank 11.8, in the window, mac |
| #8291 | #8282: chat lines at 18px | rank 11.7, in the window |
| #8273 | #8270: a post to someone off the project says so | notesOnly 81 |
| #8274 | #8271: fewer community nudges; holds say when last confirmed | notesOnly 82 and 83 |
| #8292, #8312 | #8288, #8304: kosmos agent list says who is stuck | notesOnly 84 |
| #8308, #8310 | #8299, #8309: kosmos version names the build | notesOnly 85 |
| #8289 | #8232: Windows task files and network links | notesOnly 86, windows |
| #8314 | #8302: the Team map is removed | notesOnly 87 |
| #8279 | #6255: the share step | none: dark |
| #8317 | #8285: Windows release script | none: release tooling |
| #8262, #8275, #8276, #8278, #8280, #8281, #8284 | #8221 iPhone list | none: not in this cut |

Later merges (#8324 a working seat's old summary, #8326 trust for 8.3-spelled folders) are fixes that restore what was already expected, so there is nothing new to tell anyone.

## Decided
- The Windows-only folder item is retired (status shown, shownIn 0.8.00): Windows prod serves 0.8.00, which carried it.
- "Old project summaries say why" becomes notesOnly: only kosmos project show prints it, so it should not hold a window slot.
- #8270 and #8271 keep since 0.8.01 though they shipped in 0.8.00, as 0.8.00 did for two 0.7.99 items: the default kosmos whats-new shows only the newest version's notes. Cost: dated one version late.
- #8315 My Agents is not in this cut (a real red), so it has no line. It rides the next.
- Today's items rank above the older pending ones, so the window is about this release rather than 0.7.36 and 0.7.96 text.
- Weakest premise: rank is judgement. Change the number and rebuild.
