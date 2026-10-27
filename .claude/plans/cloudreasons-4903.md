# cloudreasons-4903: engine sentences say "your cloud machine" on a cloud machine (kosmos#4903 seam H, engine half)

## Ask
Mona Lisa's seam H table (#4903, 09:36Z 10-27): the engine's own sentences (presence reasons, Files "because",
made-agent step lines, refusals) say "this computer". To a person whose only window onto a cloud machine is a browser,
"this computer" is the laptop in front of them. Owner: Baron.

## Decision
Rewrite at display, not in the engine. `cloudWords()` in web/index.html, beside Angel's thisMachine(), turns "this
computer" into "your cloud machine" (and "This computer" into "Your cloud machine") only when onCloudMachine(). Applied
in the two sentence funnels every engine reason goes through (asSentence, pjSentence: about 110 call sites), in
restartFailureLine, the made-agent warning lines (tc-why), and the finish-line sites that paint engine text raw:
the single create's refusal, name refusal, partial-create sentence and step labels, an import row's refusal, and the
Remove, Delete-leftover and restore screens (their hints, refusals and outcomes, guarded by function in the test), the
Remove dialog's hint and keeps list ("on this computer" there would tell a person their files are on their laptop).

Why: the engine runs on the cloud machine, so its "this computer" always means that machine; and its sentences are also
matching keys (projects.js groupBecause, the page's regexes and their tests), which keep working on the raw text.

Rejected: rewriting the engine's literals (about 60 on the finish-line path, 574 in all) with five matchers moving in
lockstep; a server-wide JSON rewrite (it would rewrite people's own message text).

Weakest premise: an engine sentence shown raw (textContent = out.because) outside the funnels and outside the sites
above still says "this computer" on a cloud machine. Those are off the finish-line path today; a site found later gets
cloudWords() at its render.

The opposite class: page-authored text that goes through a funnel is rewritten too, which is right when the page means
the board's machine and wrong if it ever meant the person's own device. The one found is plusForgetKeptSay (its "this
computer is not removed yet" goes through asSentence while its PLUS_FORGET_WORDS tail does not), which cannot show on a
cloud machine: kosmos#7277 hides the Kosmos+ remove and kept boxes there.

Every call is guarded as the page guards thisMachine, falling back to the identity, because the repo's tests lift page
functions one at a time without their callees; cloudWords returns anything that is not a string unchanged, so off a
cloud machine every sink renders exactly as before. web.cloudwords-4903.test.js pins the guard's form at each sink.

## Tests
- web.cloudwords-4903.test.js: the funnels, restartFailureLine and cloudWords lifted from the page, cloud and control;
  a word-boundary arm; red on a mutant that drops cloudWords from pjSentence.
- docs/browser-checks/render-cloud-signin-4903.js: an engine reason and a restart failure rendered in Chromium, cloud
  and control.
