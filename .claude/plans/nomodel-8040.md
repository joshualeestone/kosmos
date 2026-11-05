# kosmos#8040, items 1 and 2: a refusal nobody can see

## The cause, measured

Item 1. `#create-msg` sits below Create agent. Pressing it runs `cstep('made')`, which hides the long form for the short
progress screen, so the page shrinks and the browser clamps the scroll to 0. `cstep('name')` then brings the form back and
nothing restores the scroll. On origin/main's page, at 1280x800: the sentence at top 993 in a window 800 tall, which is the
card's number. At 390x700: top 1089.

Item 2. `#acct-claude-msg` was inside `#acct-claude-key-step`. The Add handler writes the error into it, then on
`needsRunner` calls `acctClaudeStep()`, which hides that step. Measured on origin/main's page: the line holds the words and
has no box. The card marked this as read; it is now measured. `#acct-openai-msg` already sits at the flow's level, which is
why the OpenAI path never had this.

## The call

Item 1: one function, `createSayRefusal(text)`, used by the four places that say something in `#create-msg` as a refusal
(the refused answer not tagged to a field, a failed answer, a request that did not complete, a swarm limit whose unit
moved). It writes the sentence, brings it to the middle of the window (`scrollIntoView({ block: 'center' })`, the #7968 and
pjFieldBad shape), and puts focus on the sentence with `preventScroll`.

The sentence's own "Settings, AI Models" becomes a real button (`.linkish`) that calls `showTab('settings')` and
`settingsOpen('accounts')`. Built from nodes, not HTML, because the sentence is the engine's. It keys on the words, so every
engine refusal naming that place gets the link, Claude's and OpenAI's both, and one naming no place gets none.

Item 2: move `#acct-claude-msg` to the flow's level, as OpenAI's is. Because it can now outlive the key step, the three
dialog openers clear it. Its words go through `asSentence`, since the route's sentence starts in lower case.

The empty-name path (from the Windows walk on the card): this refusal comes first, at the field, already in the window by
pjFieldBad. What was missing is that the sample name "Casey" reads as a name already typed, so "Give the agent a name."
looked wrong beside it. While the box is refused, its placeholder is transparent: no new words, and the sample stays for
everyone else. The account refusal still needs a second press, which now shows in the window with its link.

Coming back by the link: the form is not rebuilt. `openCreate` is what empties it, so New agent after the link skips it
(`CREATE_KEPT`, `createEnter`), clears the old sentence, runs `loadCreateExtras` (what a plain New agent runs), puts back the picks it rebuilt
its menus over where the provider did not move, and any other route to `openCreate` ends the
keeping. Page memory only: a reload starts fresh.

The keeping ends 30 minutes after the link (`CREATE_KEPT_MS`). Past that a New agent starts plain. Rejected: clearing on
leaving Settings, since the way back is leaving Settings and pressing New agent; clearing when a connect succeeds, since the
person still wants their form back then. Weakest premise: 30 minutes is enough for a sign-in. If not, they retype, which is
what a plain New agent always did.

A late key answer: when it lands after the person left the key step (dialog closed, another provider, back at the picker) it
says nothing, except no Claude Code at the picker, where it is true. Residual: away, back and into the key step again while
one is held: its line lands on a key step, about the earlier press. Left, since a line under a key box about a key is not false.

## What I rejected

- Restoring the old scroll position after the progress screen. It puts back the button, not the words: below the button at
  a low scroll they stay off screen.
- Moving `#create-msg` above the button, or into a fixed banner. That changes a screen Josh cut down on purpose, and needs
  a design call this does not.
- Focusing the link rather than the sentence. A second press of the key would then leave the page (the #7968 lesson).
- Rewording or removing the "Casey" placeholder. It is Mona Lisa's to word, and hiding it only while refused answers this.
- Saying the account refusal on the first press alongside the name's. It needs the engine to check both, a bigger change
  for one extra press.
- Snapshotting the form's fields and restoring them after a reset. A longer list of state to keep in step, for what the hidden
  panel already holds.
- A second message line in the picker for item 2. Two lines for one fact, and OpenAI's shape already answers it.
- Rewording "so there is nothing to sign in to". Asked not to reword; flagged instead (below).

## New words

None. Sentence-casing of the existing route answer only.

## For Mona Lisa

"We could not find Claude Code on this computer, so there is nothing to sign in to." is now seen, and it does not say what
to do next: "Sign in with your subscription", just above it, is what installs Claude Code. Left as the engine wrote it.

The placeholder "Casey" looks like a filled-in name. Its word is unchanged and is hers to give; this fix only hides it while
the box is refused.

## Not touched, and why

- Items 3, 4, 5.
- `#tc-msg`, the Team path's line: left alone, because the card names Create agent. Reviewed: its sentence has no link, but it is in view.
- A screen reader may still offer the placeholder "Casey" for a refused box: the CSS hides it from sight only. Mona Lisa's to word.
- Other "Settings, AI Models" sentences outside New agent (the switch dialog and others) still carry no link.
- The `role label` branch keeps its focus on the label, as it did. The page gates a blank label before the request, so
  this needs the engine and the page to disagree.

## The weakest premise

Windows was not run with this fix. It is the same web page and the card's Windows walk measured the same numbers before the
fix, so a browser check covers its logic, but no one has pressed it there.

That the scroll behaves the same in the real app's window as in headless Chromium. Kosmos's own window was not run: the
800-tall size is read from source, and a webview's scroll anchoring could differ. `scrollIntoView` and `elementFromPoint`
are plain web features, so I expect the same answer, but it is reasoned, not measured.

What would change the call: a design review that wants refusals above the button, or a report that focus on a status line
reads twice in a screen reader (#acct-flow-say already has this shape; not tested with a real screen reader).
