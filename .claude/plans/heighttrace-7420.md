# heighttrace-7420: Debug switches that measure the chat list's height estimate (kosmos#7420)

## Finished looks like
A Debug build of the iPhone app can reproduce, on the simulator, every measurement posted on #7420 on 11-03:
the small first page (#7810) against the whole window, the content height against the drawn rows every half
second, a walk to the top that stands in for a reader, and a far jump to the newest message from there. Release
builds are unchanged, and the room logic tests (including the trace allow-list) pass.

## What it adds (all Debug only, all off unless the environment switch is set)
1. `KOSMOS_SAMPLE_FIRSTPAGE=1` (BoardClient.threadRead, sample path): a read with `tail` gets the newest `tail` rows,
   with olderCount counting the rest, as server.js answers it since #7810; every whole-window read waits 1 s first
   (each later poll too, not only the read after the small page, so the poll cadence reads about 6 s in a trace), as
   a phone's second read lands later. One `thread(for:)` call per read, so KOSMOS_SAMPLE_GROW grows once per read.
2. `KOSMOS_SAMPLE_HEIGHT=1` with `KOSMOS_SAMPLE_TRACE=1` (KeyboardHold.Probe): every 0.5 s a trace line of points and a
   count: content height, offset, rows drawn, the first and last drawn row's place, the content past the last.
   The timer stops itself when the chat leaves the window. `heightLine` is admitted to the trace allow-list by name,
   and its body is pinned by a source check, as `numbers(sv)` is.
3. `KOSMOS_SAMPLE_WALK=1`, read only when `KOSMOS_SAMPLE_TRACE=1` and `KOSMOS_SAMPLE_HEIGHT=1` are set too (alone it does
   nothing: the walk exists to be read in the height lines). 4 s after opening, a screen up every 0.3 s to the top. It posts `.sampleWalking`, so the
   chat sets personScrolling, clears atBottom and lets the id anchor go, as a finger's scroll does (without that,
   SwiftUI put the list back on the "end" id at each update). At the top it stops, and 2 s later asks for the
   newest message as the New messages capsule does. After 400 steps (2 minutes) without reaching the top it stops
   and traces "walk gave up", so a run whose offset keeps moving reads as that rather than as a hang.

## Decided
- HEIGHT and WALK measure a chat's list only: ChatView marks its RowTops (`isChat`), and the room screen, which uses
  the same KeyboardHold, is skipped. The walk runs only once the chat has taken its start (on screen, anchor let go);
  otherwise it traces "walk not taken" and stops.
- HEIGHT and WALK live in KeyboardHold.Probe, so they are silent below iOS 26 and with KOSMOS_SAMPLE_NOKBHOLD=1
  (the Probe is off there, and RowTop readings exist only on iOS 26 and later).
- Debug only, behind environment switches, like the KOSMOS_SAMPLE_* switches beside them. Nothing in a Release build.
- The height line carries no ids: per-row ids would need an allow-list judgement and the counts answer the question.
- Not a UI test: these are measurement tools for a person reading the trace; a test asserting the numbers would pin
  SwiftUI's estimate, which changes with iOS releases.
- Rejected: a non-lazy VStack or a UIKit table as the #7420 fix (see the card); this branch measures, it fixes nothing.

## Verified
- Room logic tests 804 checks pass, including both #7420 checks. Control: a stray `\(v.description)` in the height
  trace line fails the allow-list check (65 values; not allowed: v.description), restored after.
- Debug simulator builds compiled at each commit (iPhone 17e, iOS 27.0); four runs' numbers are on #7420.

## Weakest premise
That the walk stands in for a reader. It sets the same flags a drag sets, but a finger also passes through scroll
phases (interacting, decelerating) that the walk does not.
