# The installer's reachability check must be able to say no

**Branch:** `reachable-1662`  ·  **Card:** kosmos#1662  ·  Ice Cream Kitty, 2026-08-31

## The defect

`reachable()` in `install/setup.sh` accepted **every** URL, including names that
cannot exist. Its fallback asks the host for the first byte of the target, and a
web server answers a range request for its own 404 page with `206 text/html`,
which curl reports as success.

Measured against installkosmos.com, with both controls:

```
kosmos-arm64.tar.gz      HEAD fail (correct)   RANGE PASS  <- false
zzz-cannot-exist.tar.gz  HEAD fail (correct)   RANGE PASS  <- MUST-FAIL control
latest.json (real file)                        RANGE PASS  <- must-pass control
```

A check with no failing case is not a check.

## Why it mattered, and it is not the wrong answer

**The cost was silence.** `if ! reachable "$url"` could never fire, so the
sentence written for exactly this situation ("could not reach the download at
$url ... it is safe to re-run") was dead code. Somebody whose download was
missing met a bare curl failure with no guidance. That is part of why the
missing binaries on 2026-08-30 went unreported for thirteen hours.

## What changes

`reachable()` now judges the **content type** as well as the status, on both
arms, so an error page cannot impersonate a download.

## The decision that matters: refuse textual, do not demand binary

The first version of this fix used an **allowlist** of binary content types.
That is stricter-looking and wrong, for two reasons, both measured:

1. **It breaks this project's own install gate.** `curl` on a `file://` URL
   succeeds and reports an **empty** content-type, and `tools/test-install.sh`
   drives the entire release path over `file://` on purpose ("curl serves
   file:// for both probes, so no server is needed"). An allowlist refuses a
   genuine tarball there and aborts the download path.
2. **The cost is asymmetric.** A false YES only means the pre-check did not
   help and curl fails a few lines later with its own error, which is the
   behaviour before this guard existed. A **false NO blocks the install
   outright** behind "Check your internet connection".

So the predicate refuses positively-textual types (`text/html`, JSON, XML,
and NOT `text/plain`, for the reason under Weakest premises below) and
accepts anything else, including empty and unknown. Media types are compared
lowercased, per RFC 9110 section 8.3.

Curl's exit status is checked first and separately, so an empty content-type
from a **failed connection** is not read the same as an empty one from a local
file that is genuinely there.

## Verified

Eleven cases against real servers, not fixtures. Every arm that must refuse
still refuses:

```
file:// real gzip                      YES   (the case an allowlist broke)
application/gzip · Application/GZIP    YES   (case-insensitive)
application/x-tar · no header at all   YES   (would have been false NOs)
application/octet-stream               YES
404 page answering 206 text/html       NO    (the original defect)
200 carrying text/html                 NO
host that cannot resolve               NO
production real tarball                YES
production name that cannot exist      NO
```

## The install gate, anchored to the bytes it tested

`yarn test:install` is the only gate that drives `reachable()` end to end. The
node suite structurally cannot: `test:shell` runs `bash -n
tools/test-install.sh` (a syntax check) and `test:install` sits outside `yarn
test`. An earlier claim on this branch that "the full suite is green" was never
evidence about this code path.

🛑 **THE FIRST TWO RECORDED RUNS WERE BOTH STALE, AND THE SECOND WAS STALE
THROUGH THE FIX FOR THE FIRST.** Run one predated the `set -e` fix by seven
minutes. I then moved a `diff -q` assertion inside the job and wrote that the
problem "cannot recur silently" - and it recurred immediately, because **an
assertion inside the job protects a RUN, not a later COMMIT.** I ran the gate,
then committed `application/*+json*`, then kept citing the number. A reviewer
found it both times.

✅ **So the evidence is anchored to the SHA256 OF THE TESTED FILE, not to a
commit and not to my discipline.** Anyone can check it in one command against
any future HEAD:

```
tested-source-sha256   c4fae33e...   the sha the GATE RAN AGAINST (commit ac69295d)
bundle-sha-matches     dist/setup == install/setup.sh, asserted BEFORE the harness
source-sha-at-end      c4fae33e... (identical, so nothing moved mid-run)
assertions             328 (a run that asserted NOTHING is not a pass)
attempts               1

  shasum -a 256 install/setup.sh
```

**If that command does not print `tested-source-sha256`, the gate did not run
against the file you are holding, and the exec-identical argument below is what
closes the gap.** That is the property the previous two remedies lacked.

🛑 **A THIRD STALENESS, AND IT WAS IN THE FIX FOR THE FIRST TWO.** This table
used to carry a second row naming the CURRENT HEAD sha. That row goes stale on
every comment edit, including the ones made to satisfy a review, so it was
wrong again within a day of being written and the document's own rule voided
its own evidence. Recorded rather than quietly corrected, because it is the
third instance of one shape.

✅ **The fix is to delete the field, not to maintain it.** A row that must be
updated by hand every time anything changes will go stale, and an anchor that
fails on itself teaches readers to ignore anchors. What is kept is the half
that discriminates: the sha the gate ran against, plus a reproducible
comparison anyone can run against any future HEAD.

✅ **The gate was NOT re-run, and here is the argument, with a control.** The
executable text is unchanged: stripping comments and blank lines from the
anchored revision and from HEAD gives **1268 identical lines**, re-measured. The same
comparison against a commit that DID change behaviour differs, so it can
discriminate. Reproduce it with:

```
git diff ac69295d HEAD -- install/setup.sh    # read it: comments only?
```

🛑 **AND AN EARLIER VERSION NAMED THE WRONG BASE, WHICH IS WORSE THAN A LOSSY
FILTER BECAUSE IT ARGUED AGAINST ITSELF.** It said `85b75857`, which PREDATES
`--max-filesize` and the exit-63 mapping, so running it showed EXECUTABLE
changes and told the reader this evidence was void. The correct base is the
commit the gate actually ran against, `ac69295d`; that comparison is
exec-identical at 1268 lines. My conclusion was right and my document could not
establish it.

🛑 **AN EARLIER VERSION OF THIS RECIPE WAS ALSO LOSSY IN THE REASSURING DIRECTION
AND IS RETRACTED.** It used `sed 's/[[:space:]]*#.*$//'` to strip comments,
which also truncates EXECUTABLE lines containing `#` inside a parameter
expansion. `install/setup.sh` has **14** such lines. Measured: changing
`${_stg##*.}` to `${_stg#*.}` -- a genuine behaviour change -- strips to the
same text, so that recipe would have certified it "comment-only" and told a
reader the gate need not be re-run.

⇒ **A control that shares the instrument's blindness certifies the wrong
answer**, and this one was published in a plan for other people to run. Read
the raw diff. If a mechanical filter is wanted, `grep -v '^[[:space:]]*#'`
removes whole-line comments only and distinguishes the case above (verified
both ways).

⚠️ **This argument is only valid while the delta stays comment-only. Any change
to executable text means the gate must be re-run, not re-argued.**

```
327 passed, 1 failed

PASS  download-path install exits 0     PASS  the versioned artifact name was fetched
PASS  download-path board answers       PASS  the refusal names both versions
PASS  tampered download refuses         PASS  no false installed-done over old bytes
PASS  tamper refusal speaks a sentence  PASS  stage residue swept from the home folder
PASS  no stage residue after refusal    PASS  pinned install exits 0
```

⭐ **The remaining failure is invariant across FIVE runs whose code differed**
Byte-identical detail every time, while the code changed under it:

```
run 1   baseline
run 2   + set -e fix, /usr/bin/tr, problem+json
run 3   + *+json*, contract comment, cost correction
run 4   + --max-filesize on the second probe
run 5   + curl exit 63 mapped to a successful fetch
        327 / 1 every time, same file named every time
``` A failure caused by this diff would have moved when the diff
moved. The assertion is `EXPECTED_ADDS` in the LOCAL-SOURCES install, which
`tools/test-install.sh` says, in the comment above its `file://` origin block,
never runs `reachable()`, `verify_download()`
or tar; the unexpected file is `wouldping/needs-you.jsonl`, a runtime
notification record, and `main` carries the identical expectation. **No control
run on `main` was performed**, so the attribution rests on the invariance, not
on that reasoning.

## Named follow-up, deliberately NOT done here

🛑 **SUPERSEDED BY ITERATION 17, WHICH SHIPPED THIS.** The reasoning below is
kept because it records why it was deferred and what changed, but the deferral
itself no longer describes the branch: `reachable()` now returns 2 for "answered
but served no download" and each guard picks its own sentence. A reader who
stops here would be told the shipped behaviour does not exist.

`reachable()` collapses two distinct causes into one `return 1`: a connection
that failed, and an origin that answered fine but served an error page. The
sentence this card resurrects says *"Check your internet connection and paste
the install line again; it is safe to re-run."* **For the half-published-CDN
case, which the call-site comment names explicitly, that advice is wrong** - the
network is fine and re-running cannot publish a missing artifact.

A distinguishable status (1 = could not connect, 2 = answered but is not a
download) would let each caller print the right sentence.

⚠️ **Deferred on scope, not on merit.** This card is "the check cannot fail";
making the failure MESSAGE distinguish its causes is a different change,
touching three call sites and new user-facing copy in release tooling during a
merge freeze. Worth doing, and worth doing on its own.

## The `set -e` shapes, measured

Under `set -euo pipefail`, which the installer sets near the top of the file:

```
f(){ local a; a=$(false); echo REACHED; }   -> nothing printed, rc=1
g(){ false && return 0; echo REACHED; }     -> REACHED, rc=0
h(){ local a rc; a=$(false) && rc=0 || rc=$?; echo "REACHED rc=$rc"; }
                                            -> REACHED rc=1, shell alive
```

A bare `_r_ct=$(curl …)` is the first shape: a failing HEAD probe aborts the
shell before the range-GET fallback runs. The pre-#1662 code was the second
shape and safe only by accident. The third is what ships.

## The weakest premises, both directions

**Accepting an unknown content-type** means a host that serves an error page
with no type at all still passes. I judged that the right trade because the
false-NO cost is an unusable installer, but it is a real hole.

**Refusing `text/html` and not `text/*`** is the same trade in the other
direction, and the first version of this plan named only the first one. A
plain-text error page now passes. The reason is that `text/plain` is nginx's
compiled-in `default_type`, so a mirror that has not mapped `.gz` serves a
genuine tarball as `text/plain` and refusing it would block that install
behind "Check your internet connection". `KOSMOS_RELEASE_BASE` is overridable
(the `KOSMOS_RELEASE_BASE=` default near the top of the installer), so a mirror is a real case rather than a
hypothetical. Production is separately mitigated because `serves_gzip()` in
`tools/kosmos-artifact-check.sh` gates the release on a gzip type, but that
mitigation does not extend to a mirror.

**Refusing `text/html` on a genuine tarball** is a THIRD of the same shape, and
the first two versions of this section named only two. An origin that
mis-serves a real `.tar.gz` as `text/html` is now a HARD install block behind
"Check your internet connection". It is unlikely (nginx defaults to
`text/plain`, S3 to `octet-stream`, and both are accepted) and it follows
directly from the refusal list rather than being an oversight, but it IS a
false NO, which is the expensive direction, and it belongs named beside the
other two rather than left implicit in the design.

⇒ All three resolve the same way on purpose: **a false YES costs nothing
the code did not already cost** (curl fails a few lines later with its own
error), **a false NO is an installer that refuses to run.** A reviewer who
weighs those differently should change the predicate, not the tests.

## Iteration 15

Three WARNINGs, one CONVENTION, one NIT. I verified all three WARNINGs against
the code myself rather than accepting the reviewer's reading.

**The cost of a false NO at the TARGET_VERSION probe was overstated, and that is
this branch's central argument.** My comment said a false NO there falls through
to the plain unversioned name and inherits the cache-collision hazard. It does
not, for any network install. `BUST=yes` is set for every http/https base, and
`install_kosmos` is called after that point, so the fallback is the `elif` arm
fetching the cache-busted `kosmos-$ARCH.tar.gz?v=...`, which a cache treats as a
fresh resource. The bare unversioned name is reached only when BUST is empty,
which is `file://` bases, and those have no cache to collide with. Verified by
reading the branch structure and confirming the call site is after the
assignment, because position in a shell script is not execution order.

Corrected in the installer. A maintainer weighing this design was being handed a
cost larger than the real one.

**The `--max-filesize` claim was stated as a guarantee and is version
dependent.** The macOS manpage says the transfer does not start, so the decision
comes from an announced content-length, and curl only began aborting an
in-flight transfer in 8.4.0. The declared floor is 13.5, which ships curl 8.1.x.
So on the floor OS, against an origin that omits content-length, the residual is
bounded by `-m 15` and not by the cap. Measured here on 8.7.1 the cap does stop
a length-less transfer mid-flight. Both facts are now in the comment.

**The suite could not tell "the cap works" from "the cap works when a length is
announced".** Every cap fixture sent content-length, so the one shape the option
is documented not to act on had no arm. Added `/nolen.tar.gz`, same body served
chunked. The arm asserts the verdict strictly and deliberately does not pin a
byte count, because the count is the part that legitimately varies by curl
version. I measured it before deciding what to assert: a temporary strict
assertion passed on 8.7.1, which told me the cap does engage here, which is
exactly why pinning it would encode this machine rather than the contract.

**CONVENTION, partly addressed and I am not claiming more.** The block was 157
comment lines to 26 executable. I removed the one piece of self-referential
iteration history inside my region. It is now 162 to 31, because the two
corrections above are additions. The ratio is worse in raw count and better in
content: what I added is decision-relevant and what I removed was narrative
about the comment's own drafting. The exit-63 passage stays; the reviewer named
it as one of two traps worth keeping, and it explains why the mapping exists.

**NIT, corrected.** I wrote "six other tr call sites". There are seven others:
six absolute and one bare at the `_pids` line. My grep for this initially gave
three different answers because "tr " matches inside words like string and
control, which is the pattern being wrong rather than the artifact.

## Iteration 16

Four WARNINGs, three NITs. The first one is about this document.

**The anchor I introduced to end stale gate evidence went stale itself.** The
table carried a row naming the current HEAD sha. That row changes on every
comment edit, including the ones made to satisfy a review, so it was wrong
within a day and the document's own rule three lines below it voided its own
evidence. That is the third staleness on this branch and the first two are what
the anchor was written for.

I deleted the row rather than updating it. A field that has to be maintained by
hand every time anything changes will go stale, and an anchor that fails on
itself teaches a reader to ignore anchors. What is kept is the half that
discriminates: the sha the gate ran against, plus a comparison anyone can
reproduce against any future HEAD. The substance was never in doubt and I
re-verified it: comment-stripped, the tested revision and HEAD differ by zero
lines at 1268.

**The document also gave two different numbers for that same measurement**, 1267
in one place and 1268 in another. Measured: 1268. A reader running my own
published recipe would have falsified one of my claims with no way to tell
which. Both now say 1268.

**Nothing pinned how many callers `reachable()` has.** Every arm tested a caller
that already exists; none would notice a fourth added later, and the cost is
asymmetric in the direction this design calls its worst outcome. The predicate
refuses anything positively textual, and the live origin serves
`/dist/latest.json` as `application/json`, so a probe aimed at a pointer returns
a false NO. It is safe today only because the pointer fetch uses bare curl.

Added an arm pinning the count at three, using the same read-the-source idiom as
`one-derivation.test.js`. It strips comments first: two of the five textual
matches are inside comments, so a raw count would pin the wrong number and pass
for the wrong reason. Verified by planting a fourth caller aimed at
`latest.json` and watching it go red, then restoring.

**The HTML-on-63 refusal rested on a curl version and did not say so**, while
the comment beside it is careful about exactly that for the cap. Refusing a
capped HTML body needs curl to still report a content-type alongside exit 63.
Measured on 8.7.1 it does; on the floor's 8.1.x the abort precedes the transfer
and that arm could flip. Named it. The shipped direction is the harmless one; a
red suite on a floor-OS runner is the real cost.

**`application/*+xml` was refused only in the +json direction.** A structured
suffix type is textual by construction and is never a tarball, so admitting one
and refusing the other was an inconsistency rather than a decision. Added, with
an arm that carries a control, and verified by removing the predicate and
watching the arm redden.

**Two NITs, one of which was worse than reported.** The concurrency rationale
for keying `BYTES_SENT` by path was physically attached to `SEEN`, which is a
plain array reset globally two arms below, so the comment defended a property
the variable it sat on does not have. Both are fine because node:test runs a
file's arms sequentially; the comment now says that instead of claiming a
defence. The fixture also lacked an error handler on the responses that three
arms deliberately cause curl to hang up on, which is an intermittent crash in
exactly the arms whose job is being hung up on.

## Iteration 17

**The cost argument rested on a branch nothing exercised.** In iteration 15 I
corrected the comment to say a false NO at the version probe falls into the
cache-busted `elif`, not the bare name. I never tested that branch. The harness
already had the knob (`runProbe` accepts `bust` and `target`) and neither caller
passed it, so every probe arm ran with `BUST=''`, which is the `file://` case.
The one arm the whole argument depends on had no assertion at all.

Added two: a false NO on a network base must select `?v=9.9.9`, and an
unversioned run must still bust the cache through the `${...:-$$}` fallback.

**I reversed my own deferral on the wrong sentence, and it is the right call.**
The plan named it a follow-up: `reachable()` collapsed "could not connect" and
"answered but served an error page" into one status, so a half-published CDN
told the user to check an internet connection that is fine, when re-running
cannot publish a missing artifact.

What changed my mind is a fact I did not have when I deferred it: before this
branch the guard could never fire, so that sentence was unreachable. This card
is what makes it live, and the half-published CDN is the most likely way to
reach it. Deferring means shipping a wrong user-facing message that my own
change created. The fix is local: status 2 for "answered but not a download",
and every caller uses `!`, `&&` or `!= 0`, all of which treat 1 and 2
identically, so no control flow moves anywhere.

Weakest premise: I am asserting the new sentence is better, and no user has read
either. If Josh wants different words, they are one string each and the
mechanism does not change.

**Three things went wrong while doing it, and each was caught by a guard rather
than by me.**

The guard rewrite broke the test file's extraction regex, which was pinned to
`if ! reachable "$url"`. That is the stale-assertion class, and the assertion
existing is the only reason a rewritten guard did not leave the arms silently
testing a block that no longer exists.

Re-anchoring it then failed for a second reason: the new guard contains a nested
`if/else/fi`, and a non-greedy match to `fi` stopped at the inner one. The
extracted fragment was unbalanced, the harness shell died, and the arm reported
"the guard said nothing", which reads as a code defect rather than a broken
regex. The end anchor is now the outer block's own last statement.

Then I asserted the served-error case surfaces as `rc=2` upstream. It went red.
Both cases return 1 to the caller, deliberately: status 2 is consumed inside the
guard to choose a sentence, and `install_kosmos`'s contract stays a single
failure. The assertion taught me what my own change did. It now pins that
contract, so an edit leaking 2 upstream reddens.

**Two NITs, both about instruments rather than code.** The call-site census
stripped only whole-line comments, so one inline `# see reachable "$url"` would
have inflated the count and reddened for a reason unrelated to a new caller.
Fixed and verified both ways: it ignores a planted inline comment and still
catches a planted real caller. And the guard harness ran `f` bare under
`set -e`, so on the NO path the shell aborted before the rc line: that output
was dead and looked like a measurement. Captured properly, and now asserted, so
it cannot drift back.

**CONVENTION, and I am going to stop trimming.** Two reviewers have flagged the
comment ratio in this region. I have removed every passage that narrates this
comment's own drafting, twice. What remains is decision content and two traps,
and it is 185 to 18 because I keep adding corrections the reviews ask for. The
file's own convention is heavy commenting, and a trap warning belongs where the
code is rather than in a plan file nobody opens while editing. Recording the
ratio as deliberate rather than reporting it fixed.

## Iteration 18

**I introduced a regression in iteration 17 and then wrote an assertion that
guaranteed it.** The status-2 sentence blamed the release: "the release is
probably still publishing". But status 2 has TWO causes and this layer cannot
separate them. A captive portal, a corporate proxy block page and an ISP
NXDOMAIN redirect all answer 200 with text/html, which is byte-for-byte the
same signature as a half-published CDN. Traced it through the predicate: both
probes refuse the textual type, `_r_rc` stays 0, so both land on status 2.

So I replaced advice that was wrong for CDN users with advice that is wrong for
portal users, pointed the other way. That is not an improvement, it is the same
defect rotated.

**And the assertion was worse than the string.** My arm asserted "Check your
internet connection" was ABSENT on that path. That did not merely fail to catch
the portal case: it made the only correct sentence for those users impossible to
add without going red. An assertion can pin a defect in place, and mine did.

The sentence now names both causes, and the arm requires both to be present
rather than requiring one to be absent. Verified by dropping the intercepting
clause and watching it redden.

**Added the must-fail arm the file:// coverage was missing.** There was a
must-pass arm only, and this file's own thesis is that a must-fail is the only
thing that proves an instrument works: "file:// is reachable" is equally
consistent with a predicate that says YES to everything. A missing file:// path
must be NO. It matters because `tools/test-install.sh` drives the whole release
path over file://, and the refusal paths there are what this branch makes live.

**`_r_why` is now local**, matching `reachable()`'s own vars two lines above,
and the guard extractor was widened to keep the `local` keyword so the harness
still runs the shipped text rather than a variant of it.

### Deferred, with reasoning

**The known-red arm on the floor OS.** The large-textual-body refusal depends on
curl reporting a content-type alongside exit 63, which holds on 8.7.1 and may
not on the floor's 8.1.x. The reviewer suggested a skip guard keyed on
`curl --version`. I am not adding one. There is no floor-OS runner today, the
trade-off is already written at the call site, and a version-keyed skip trades a
hypothetical future red for silently reduced coverage on the exact platform we
care least about breaking. If a floor-OS runner is ever added, add the guard
then, and make it print why it skipped rather than skipping quietly.

**The duplicated eight-line guard** in `fetch_tmux` and `install_kosmos`. The
reviewer raised it and explicitly did not ask for extraction, because the arms
pin `GUARDS.length === 2` and a helper makes it a two-file change. The
duplication predates this branch. Left alone.

## Iteration 19

**The case this card exists to fix was only half covered, and my own arms could
not see it.** Both probes carry `-f`, which makes curl exit non-zero on a 4xx
even though the request completed. So `_r_rc` was never 0 for a hard 404 and
`reachable()` returned 1, printing "Check your internet connection" for an
artifact that is simply not published yet.

Status 2 was only ever reached by origins whose error page answers 2xx. This
site's 404 replies 206 with its own HTML, which is exactly why every arm passed:
**the fixture and the production origin share a shape that the standard case
does not.** S3, R2 and GitHub Releases return a hard 404, and that is the most
common half-published signature.

Measured on real origins before and after: a GitHub Releases 404 gives exit 56
with http_code 404, and now yields status 2 where it used to yield 1. Both
probes capture `%{http_code}`, status first because a content type contains
spaces and a status code never does.

**The two halves of this feature were tested against themselves and never
joined.** The YES/NO harness collapses 1 and 2 by construction, and the guard
arms stub `reachable()` to a chosen verdict. So deleting the status-2 lines from
the installer left every arm in the file green while making the new sentence
unreachable. That is precisely the dead-code defect this card was opened to
remove, one layer up, and I built it while removing the original.

Added a status-returning harness and four arms pinning the real predicate: 0 for
a real download, 1 for a refused connection, 2 for a 200 HTML body, 2 for a hard
404. Verified by deleting both status-2 rules (two arms redden, previously zero)
and by deleting only the http_code rule (exactly the hard-404 arm reddens).

**The guard contradicted itself for one iteration.** On the status-2 path it
printed "could not reach the download at $url" and then "The server answered but
did not send an installable file". Two diagnoses of one failure, in consecutive
lines. The first line now appears only where it is true, and an arm asserts both
directions.

**And the claim that the new status moves no control flow was unasserted.**
`runProbe` had only ever been called with 0 and 1. Status 2 must select the same
url as status 1, because `&&` treats any non-zero as false; that is now pinned.

### Still deliberate, restated because a reviewer flagged it again

The comment ratio in the `reachable()` region. Recorded as a decision in
iteration 17 and unchanged. This reviewer independently spot-checked the factual
claims in those comments (the seven `tr` call sites, the 13.5 floor, `BUST=yes`
being set before `install_kosmos` runs) and found them accurate, which is the
property that makes the comments worth their length.

## Iteration 20

**The http_code fix I shipped in iteration 19 had a dead store, and it failed in
the same direction as the bug it replaced.** Each probe assigned `_r_code`, and
the second overwrote the first. So a HEAD that got a definite answer (a hard
404, or a 200 carrying HTML) followed by a range GET that failed to COMPLETE
(reset, DNS blip, an origin dropping the second connection) left code 000 with a
non-zero rc, and the caller told the user to check a connection about a server
that had plainly answered.

The fact is now accumulated in `_r_answered` across both probes rather than
replaced. Written as an `if` rather than `{ ...; } && _r_answered=1`, because as
a standalone statement that compound returns non-zero when both tests are false,
which under `set -e` kills the shell.

New fixture reproducing exactly that shape: HEAD returns 404, the ranged GET
destroys the socket. Verified by turning the accumulator back into an overwrite
and watching that arm redden.

**The census could not see an unquoted caller.** It matched `reachable "`, so a
fourth caller written `reachable $url` or `reachable ${url}` would have left the
count at three and passed. That arm's entire job is noticing a caller nobody has
written yet, so assuming that caller copies the quoting style of the three that
exist defeats it. Widened and verified against both unquoted forms.

**A claim in the comment was overstated and this branch's own test contradicted
it.** It said the old predicate "accepted EVERY url, including ones that cannot
exist". A missing `file://` path already failed with rc 37, and there is an arm
asserting it. Scoped to HTTP origins whose 404 page answers a range request,
which is where it is true.

Also moved a stray `require` up to the others.

### Declined, with the measurement rather than an argument

**Extracting the duplicated status-dispatch block into a helper.** The stated
risk is that duplicated user-facing copy "can silently diverge". I tested that:
edited the sentence in ONE guard only, and the suite went red. The arms loop
over every extracted guard and assert both sentences in each, so divergence
between guards is caught, not silent. Two reviewers have now raised this
duplication and the first explicitly declined to ask for extraction because the
census pins `GUARDS.length === 2`. Leaving it.

**Shortening the timeout on the two `127.0.0.1:1` arms.** They rely on loopback
refusing rather than dropping; on a host with a filtering rule they would burn
`-m 15` each. I am not changing it, because the timeout is inside the shipped
`reachable()` text and the whole point of that harness is running the shipped
text rather than a variant. Measured here: both arms complete in about 15ms, so
the cost is hypothetical on this machine and the fidelity is not.
