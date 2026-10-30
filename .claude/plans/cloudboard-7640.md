# cloudboard-7640: Kosmos Cloud board pages from the 10-30 walk (#4903 items 1, 2, 3, 6)

Card: kosmos#7640 (filed by Mona Lisa 12:0x CDT 10-30 from Angel's walk on #4903; routed by Splinter; Kitty left these
for the board owner). Angel confirmed no clash with her #7634 (the step-up sentences are hers; this card does not
touch them).

## Finished looks like

On a cloud machine: no provider sign-in sentence says "this computer" about the hosted machine; a create refusal reads
as a sentence (capital, full stop) with "your cloud machine" in it; and a remote session stops asking for
/api/remote/waiting after its first 403. Items 1 and 3 are answered on the card with the decisions that already stand.

## What was built

- **Item 6, the poll.** pollWaiting sets WAIT.refused on a 403 and returns at once from then on. A page opened through
  Kosmos+ is remote for its whole life, so nothing can make the answer change without a reload, which starts asking
  again. Before: every 5 s for ever (720 refused requests an hour per open tab on a cloud machine).
- **Item 2, copy.** The five "Your agents (then) run on your own subscription, on this computer." sentences wrap "this
  computer" in `<span data-cloud-copy="thisMachine">`, the existing seam H mechanism (applyPlatformCopy), so a cloud
  machine reads "your cloud machine". One of the five is the Windows copy table's entry: harmless (a Windows board is
  never a cloud machine).
- **Item 2, the refusal.** The create form's two refusal lines and the import row's failure now use asSentence (which
  applies cloudWords itself), guarded as `(typeof asSentence === 'function' ? asSentence : (typeof cloudWords ...))(`
  so a function lifted alone by a test still says it through cloudWords. web.cloudwords-4903's pin moved to that form.

## Decided, not built

- **Item 1 (guided setup offers only Claude on a cloud box).** That is seam G, decided 10-27 (Mona Lisa on #4903,
  12:34 UTC): Claude alone until OpenAI and Grok are measured on Linux, or Josh asks. The walk note does not change
  either condition, so it stands. The create form listing more is the opposite question (whether to hide connected
  providers there) and is not reopened here.
- **Item 3 (About you placeholder "Josh").** Josh's own call of 2026-09-08 (recorded in the code beside the field): he
  overrode #683's "Alex" back to "Josh" because he has a teammate named Alex. It stays; the code comment already names
  a neutral example ("Sam") if he wants one.
- **Design shots: not taken.** mobile-shots.js has no cloud mode (seam H's pending item), and the one visible change is
  one phrase drawn by the reviewed data-cloud-copy mechanism, proven by the lifted test. Weakest premise: that nothing
  else on those panels reads differently on a cloud machine.

## Tests

web.cloudboard-7640.test.js (5): the poll asks once after a 403 (control: a 200 keeps asking); every sentence is
wrapped; applyPlatformCopy says "your cloud machine" on a cloud machine (control: "this computer" elsewhere); the
refusal reads as a sentence on both (control). Control: without the early return, the poll test goes red.
web.noise0757 counts the sentence as read (span tags taken out).
