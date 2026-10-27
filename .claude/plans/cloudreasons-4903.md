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
Remove dialog's hint and keeps list ("on this computer" there would tell a person their files are on their laptop).

Why: the engine runs on the cloud machine, so its "this computer" always means that machine; and its sentences are also
matching keys (projects.js groupBecause, the page's regexes and their tests), which keep working on the raw text.

Rejected: rewriting the engine's literals (about 60 on the finish-line path, 574 in all) with five matchers moving in
lockstep; a server-wide JSON rewrite (it would rewrite people's own message text).

Weakest premise: an engine sentence shown raw (textContent = out.because) outside the funnels and outside the sites
above still says "this computer" on a cloud machine. Those are off the finish-line path today; a site found later gets
cloudWords() at its render.

## Tests
- web.cloudwords-4903.test.js: the funnels, restartFailureLine and cloudWords lifted from the page, cloud and control;
  a word-boundary arm; red on a mutant that drops cloudWords from pjSentence.
- docs/browser-checks/render-cloud-signin-4903.js: an engine reason and a restart failure rendered in Chromium, cloud
  and control.
