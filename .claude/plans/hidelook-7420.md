# #7420: look at the list after a keyboard has gone down

Addresses #7420.

## What finished looks like
After a keyboard finishes going down, a chat past its end or with nothing drawn is put right by the same looks a did-show gets. A drawn list, or one under a finger, is not moved.

## Measured, Josh's capture on build 48, numbers only
Keyboard down at 393.58, end marker gone 393.61. At the report: y 12630, content 15830, insets 113/96, nothing drawn. After the rebuild: y 11745, content 12197, insets 113/492 with the keyboard already down; row tops 11686 to 11850, screen shows 11858 to 12185. So every drawn row starts above the screen. With the inset back at 96, y 11745 would be 396 pt past the end of 11361.

Nothing looks afterwards: the will-hide handler cancels every waiting look (kbSettleTick), and the only did-hide handler is the Debug rebuild hook.

## Decided
- The existing looks, on did-hide. They already rule on "past the end", "within and nothing drawn" and "under a finger". Rejected a new recovery: another path through the same code.
- boxMoved false: a keyboard going down must not move a drawn list. Rejected true: that arm moves a drawn list with its end gone, and a reader who dismissed the keyboard to read would be pulled.
- The will-hide cancel stays: it stops looks timed for the keyboard that is leaving.

## Weakest premise
That this is the cause. It is read from one capture. The inset reading is a moment, and row tops alone cannot say a tall row does not reach the screen: the last row starts only 8 pt above it. The simulator has never blanked on demand, so only his phone can show this. It would also not touch a blank with the keyboard staying up, as at 20:58.
Would change my mind: a capture on the build carrying this, blank after a keyboard went down, with a "keyboard settled" line in its trace.

## Review 1 (blind, sonnet)
Fixed: a look left by a did-hide could run after the next will-show, mid-animation, on a passing reading, and spend a rebuild; a will-show now cancels waiting looks, and its did-show asks again. Backgrounding brings a did-hide, and the past-the-end arm had no scene check; looks now run only while active. A look that decided nothing logged nothing; it now says so, so the next capture can tell "looked, fine" from "did not look".
