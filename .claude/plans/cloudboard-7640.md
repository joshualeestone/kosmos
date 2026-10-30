# cloudboard-7640: Kosmos Cloud board pages from the 10-30 walk (#4903 items 1, 2, 3, 6)

Card: kosmos#7640 (filed by Mona Lisa 12:0x CDT 10-30 from Angel's walk on #4903; routed by Splinter; Kitty left these
for the board owner). Angel confirmed no clash with her #7634 (the step-up sentences are hers; this card does not
touch them).

## Finished looks like

On a cloud machine: no provider sign-in sentence says "this computer" about the hosted machine; a create refusal reads
as a sentence (capital, full stop) with "your cloud machine" in it; and a remote session stops asking for
/api/remote/waiting after its first 403. Items 1 and 3 are answered on the card with the decisions that already stand.

## What was built

- **Item 6, the poll.** pollWaiting returns at once on a page reached through Kosmos+ (kplusRemote: its own address is
  not loopback), so such a page never asks; a local tab asks as before (review 1 changed this from a latch on a 403,
  which a signed-out local tab also gets). Before: every 5 s for ever (720 refused requests an hour per open tab on a
  cloud machine).
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

web.cloudboard-7640.test.js (6): a remote page never asks; a refused local tab keeps asking (control: a 200 keeps asking); every sentence is
wrapped; applyPlatformCopy says "your cloud machine" on a cloud machine (control: "this computer" elsewhere); the
refusal reads as a sentence on both (control). Control: without the early return, the poll test goes red.
web.noise0757 counts the sentence as read (span tags taken out).

## After review round 1 (opus, 12:2x CDT)

Findings: ~/.cache/monalisa-review/review-7640-round1.md. 1 blocker, 2 warnings, 4 nits.
- FIXED BLOCKER: render-createnav-2190 matched the refusal case-sensitively ("that name will not work"); it now pins the
  sentence ("That name will not work."). Ran it: passes.
- FIXED WARNINGS (one cause): the poll latched on ANY 403, and a LOCAL tab that is merely signed out is refused the same
  way (the route answers every refusal with the same code) and recovers in place, so its waiting list would have gone
  dead. Now keyed on the page's own address (kplusRemote: not loopback = reached through Kosmos+, for the page's whole
  life): such a page never asks, a local tab asks as before. Tests: remote never asks; a refused local tab keeps asking;
  a 200 keeps asking. Control (the guard removed) turns the remote test red. The browser check measures both arms.
- FIXED nits: the name field's refusal is a sentence too (four sinks now); the browser check reports an odd sentence
  rather than throwing; its poll label says what it measures.
- DEFERRED nit: a named helper for the guarded asSentence expression. A test that lifts one function alone would not
  have the helper either, so it would need its own typeof guard at each sink: the same five tokens, one more name.
