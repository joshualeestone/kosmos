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
against the file you are holding.** That is the property the previous two
remedies lacked.

🛑 **THE ARGUMENT THAT USED TO CLOSE THAT GAP IS GONE, BECAUSE IT EXPIRED AND
NOTHING ANNOUNCED IT.** It said the executable text was unchanged since the
anchored run, so no re-run was needed. Nine commits later that was false: 1268
executable lines became 1290, differing in 42 lines across five hunks, all of
them the substance of iterations 16 to 21. The document's own rule three
sections down says a change to executable text means the gate is re-run rather
than re-argued, and the document was breaking it.

⭐ **An argument has an expiry and does not announce it, which is worse than a
stale FIELD.** A stale sha fails a comparison somebody runs. A stale argument
just sits there reading as reasoning. Caught by an independent reviewer at
iteration 22, not by me, and it is the fourth instance of a staleness shape this
document already catalogues three times.

✅ **Replaced by actually running the gate. See "The install gate, run for
real" below.**

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
shape, and it was safe by the DOCUMENTED and-or exemption rather than by
accident, which the transcript directly above shows. The third is what ships.

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
replaced. Written as an `if` rather than `{ ...; } && _r_answered=1` purely for
readability.

🛑 **I first gave a false reason for that and it sat in two places.** I wrote
that the `&&` form aborts under `set -e`. It does not: an and-or list is exempt
whether or not the left side fails. Measured on /bin/sh with a control:
`{ [ a ] || [ b ]; } && x=1` survives at rc 0, `[ 1 = 63 ] && x=0` survives, and
the same compound with no `&&` dies at rc 1.

⚠️ **The claim was refuted by this document's own transcript 325 lines above it,
and by the installer four lines below it.** That file uses the supposedly fatal
shape 14 times, including `[ "$_r_rc" = 63 ] && _r_rc=0` inside the very
function the comment sits in. A maintainer who believed me would have "fixed"
all fourteen. In a file whose convention is that comments are measured claims,
an unmeasured one dressed as a measurement is the most expensive kind.

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

## Iteration 21

**A comment of mine asserted a shell mechanism that is false, and the code four
lines below it disproves the claim.** I wrote that `{ ...; } && x=1` aborts under
`set -e`. It does not: an and-or list is exempt whether or not the left side
fails. Measured on /bin/sh (bash 3.2.57), which is what this file runs under,
with a control that returns the dangerous answer:

```
{ [ a ] || [ b ]; } && x=1 ; echo AFTER   -> AFTER, rc=0   survives
[ 1 = 63 ] && x=0 ; echo AFTER            -> AFTER, rc=0   survives
CONTROL, same compound with no &&         -> rc=1, AFTER never printed
```

The installer uses that supposedly fatal shape **14 times**, two of them inside
`reachable()` itself, including `[ "$_r_rc" = 63 ] && _r_rc=0` which runs on
nearly every call. A maintainer who believed the comment would have rewritten
all fourteen. The plan repeated the same claim, and was refuted by its own
measured transcript 325 lines earlier. Both corrected, and the `if` is kept for
readability, which is the honest reason.

⭐ This is the worst kind of wrong comment in a file whose convention is that
comments are measured claims: an unmeasured assertion wearing a measurement's
clothes. I also called the pre-#1662 form "safe only by accident"; it was safe
by the documented exemption, and my own transcript said so.

**And my iteration-20 conclusion was too strong.** I claimed guard copy
"cannot silently diverge" after editing one guard and watching the suite redden.
That perturbation happened to hit an ASSERTED substring. Measured now: changing
"Wait a few minutes and paste the install line again." in one guard only leaves
the whole suite green. One arm generalised into a rule, which is the error I had
been flagging in others the same afternoon.

Closed properly and more cheaply than a helper: an arm now asserts the two guard
blocks are byte-identical, so drift in any text, asserted or not, reddens.
Verified against the exact perturbation that previously slipped through.

### Filed rather than fixed here

**kosmos#1707.** This branch makes the served content-type decide whether an
install proceeds, and only one of the artifacts it judges has a release-time
instrument on its type: `serves_gzip` covers `kosmos-<VER>-arm64.tar.gz` with a
bogus-version control. The tmux tarball, the unversioned kosmos name and every
x86_64 variant are ungated, and `tools/verify-served.sh` checks bytes and
checksums but mentions content-type zero times (control: 18 sha mentions).

Filed rather than fixed because the remedy is in release tooling, which is
batched separately, and this branch is scoped to the installer and its tests.
The residual is narrower than it first reads: these are served from one origin
with one type configuration, so a config-level mis-map would redden the gated
artifact too. The uncovered shape is a per-object regression on the tmux tarball
or the unversioned name.

## The install gate, run for real

🛑 **READ THIS FIRST: THE RUN RECORDED BELOW IS SUPERSEDED AND THE GATE IS NOW
FINAL VALIDATION, NOT PER-ITERATION EVIDENCE.**

The gate ran against `install/setup.sh` at commit `89991d64`. Executable text
has changed twice since: the `rc = 37` rule (iteration 22) and the 405/501
method-refusal exclusion (iteration 24). So the anchored result no longer
describes the file anyone is holding. **This is the third recurrence of one
shape**, and the first two were "fix the field" and "fix the argument". Both
came back.

✅ **The structural fix is SEQUENCING, not another number.** A gate result
recorded mid-loop is invalidated by the very next iteration, because every
iteration edits the file the gate measures. So:

- `yarn test:install` runs **once, at convergence**, as final validation.
- The proof file carries **that** run and no earlier one.
- No iteration records a gate result as standing evidence again.

⚠️ **A reviewer offered the escape that the post-gate delta was copy-only. I
checked and it is not**: it includes the `rc = 37` rule on both probes. Worth
saying because I would have been glad to accept it: the escape was offered in
good faith, and taking it without measuring would have produced a true-sounding
claim resting on somebody else's characterisation of my own diff.

📌 **Practical note for whoever runs it:** the gate asserts `dist/setup ==
install/setup.sh` before it starts, and `dist/` is gitignored, so a re-run needs
a rebuild first or it trips that pre-assertion. That is not committed drift.

### What the superseded run established, which still stands


`yarn test:install` is the only gate that drives `reachable()` end to end, and it
had not run since iteration 15. It has now, against HEAD.

```
my branch   install/setup.sh 78f4f18e   327 PASS, 1 FAIL, exit 1
```

The single failure is `wouldping/needs-you.jsonl` appearing in the installed
tree when the arm expects nothing added.

**It is pre-existing on main and this branch does not cause it.** I had asserted
that earlier from the failure being invariant across runs, and recorded at the
time that no control on main had been run. Here it is.

**The first control attempt was a non-result and I nearly counted it as one.** A
fresh `origin/main` worktree exits 1 with **0 PASS and 0 FAIL**, because `dist/`
is unbuilt there and the suite SKIPs. A suite that never ran is not a clean
control; it just has the same exit code as one.

**The control that works isolates a single variable:** main's `install/setup.sh`
placed in my worktree, so the same `dist/`, same fixtures, same everything, and
only the predicate differs.

```
main's setup.sh  db404c43  + my dist/   327 PASS, 1 FAIL, exit 1, SAME arm
my setup.sh      78f4f18e  + my dist/   327 PASS, 1 FAIL, exit 1, SAME arm
restored afterwards, sha re-verified 78f4f18e, git status clean
```

⚠️ **This is live for other people right now, not just for this branch.**
`tools/release.sh` runs the install gate at step 4b, so any cut in progress will
hit the same arm. Passed to Splinter and to Angel with the exact fingerprint, so
a cut that dies there is matched in seconds rather than debugged for an hour
against a failure that was already on main.

## Iteration 22

**The gate had not run since iteration 15 and my document argued it did not need
to.** Covered above under "The install gate, run for real". The argument was
stale, the gate now has, and the one failure is proven pre-existing on main by a
single-variable control.

**The status-2 sentence was true for two causes and I had let it name two.** A
403 from a private or geo-blocked bucket, and a typo'd `KOSMOS_RELEASE_BASE`,
both reach status 2, and "wait a few minutes" fixes neither. The copy now offers
three causes and a recovery that is honest for all of them: try again shortly,
and if it persists check the address.

**Rewording it immediately voided one of my own controls, which is the hazard
Splinter had broadcast an hour earlier.** The arm matched the phrase "still
publishing" and the new copy says "may still BE publishing". It went red, which
is the arm working, but the lesson is that it was keyed on WORDING rather than
meaning. Re-keyed to single stable tokens, and a third token pins the new cause.

**A missing `file://` path told the user to check their internet connection
about a file on their own disk.** `KOSMOS_RELEASE_BASE` accepts `file://` and
the install gate drives the whole release path over it. curl 37 is
FILE_COULDNT_READ_FILE: the filesystem answered and the address is wrong, which
is exactly what status 2 says. Mapped, pinned with an arm, and verified by
removing the rule and watching it redden.

### Method note worth keeping

A grep told me one `doesNotMatch` was vacuous. **Perturbation said otherwise:**
removing the `${TARGET_VERSION:-$$}` fallback reddens that arm, so it guards a
real future regression. Splinter had just corrected the fleet on exactly this,
after a colleague's grep false-alarmed on strings built at runtime: a grep finds
candidates, perturbation decides.

⚠️ And my own verification grep read **0** while the perturbation had plainly
applied. `grep` on this box is ugrep in BRE mode, where the literal pattern
returned 0 and `-F` returned 1, against a control of 1. Had I trusted it I would
have concluded the perturbation never ran and drawn the opposite conclusion.

## Iteration 23

**`-L` was the one probe component with no arm, and it is the one that matters
most in production.** Every other flag in this predicate was measured as
uncovered before being added, with a mutation that reddens. Not `-L`: the
fixture never issued a 3xx at all (0 redirect responses against a control of 4
explicit 404/405 responses).

That gap is not academic. GitHub Releases, S3 and R2 all answer an asset URL
with a redirect, and `-f` does not treat a 3xx as an error, so without `-L` curl
reports the REDIRECT's content-type rather than the artifact's. An empty type
gives a harmless false YES; `text/html` gives a FALSE NO, which this design
calls its worst outcome, on the most likely deployment shape.

Added `/redirect.tar.gz`, a 302 to the real gzip that answers with an HTML body
deliberately, so dropping `-L` reddens rather than passing by luck. Verified:
removing `-L` from both probes reddens exactly that arm.

**And my own iteration-22 fix shipped copy that was false in three of four
clauses.** Mapping curl 37 to status 2 was right FOR ONE ITERATION and iteration 26
replaced it with status 3, but at the time the sentence opened "The
server answered but did not send an installable file", and a `file://` path has
no server, no release and no network. `tools/test-install.sh` drives the entire
release path over `file://`, so that is the sentence the project's own gate
produces. Fifth time on this branch that a fix has recreated the class it
removed, and the second time on this exact sentence.

It now opens on the ADDRESS, which is true for every shape reaching status 2,
and the three causes stay hedged rather than asserted. Paired assertion: the new
opening must be present and "server answered" must be absent.

⚠️ **Residual, stated rather than papered over:** a missing local file still
reads "the release may still be publishing" as one of three hedged
possibilities. It is a possibility rather than a claim, and the address clause
is the true one for that reader, but it is not ideal copy for them.

### Considered and not done, with the reasoning

**Giving rc 37 its own status 3, and extracting a refusal helper.**

🛑 **SUPERSEDED: ITERATION 26 SHIPPED BOTH.** The reasoning below is kept
because it records why the deferral was taken and what ended it, but as a
statement of what the branch does it is false. The helper exists and is called
`_reachable_refuse`, not `_reachable_refusal`, so the name below never named
anything. A reader stopping here is told a shipped design is still outstanding.

📌 Found in my own audit rather than by a reviewer, which is the first time in
this loop. Three consecutive iterations had found a claim of mine that a later
change of mine had falsified, so I went looking for the rest.

That is the cleaner design and it would also settle the duplication four
reviewers have now raised. I took the reviewer's lower-risk alternative instead:
five of my last seven fixes introduced a defect that the next iteration caught,
the guard harness extracts and executes the shipped block verbatim, and a
three-way refusal plus a helper would rewrite both that block and the extractor
late in a long loop. The reword closes the stated defect. The helper remains the
right follow-up and is written down here rather than lost.

**The comment ratio.** Trimmed the drafting archaeology the reviewer named,
210 to 207 lines in the region. That is marginal and I am not calling it fixed:
I remove history and add decision content at about the same rate.

## Iteration 24

**A method refusal is not an answer about the artifact.** `_r_answered` counted
any status at or above 400, so a 405 on the HEAD probe set it. A 405 means "I do
not do HEAD" and says nothing about whether the file exists. So an origin that
refuses HEAD and whose range GET then failed to COMPLETE got status 2 and was
told to check the address, when the truth is a transient connection failure
whose only honest advice is that re-running is safe.

That is this card's own wrong-sentence defect, aimed at the shape the range
fallback exists for. Many origins refuse HEAD, and four paths in my own fixture
already answer 405, so the shape was in front of me the whole time and had no
arm either way.

405 and 501 are now excluded on the HEAD probe only. A 405 followed by a working
range GET is unaffected, because the range arm sets the flag on its own rc, and
there is a control arm asserting exactly that so the exclusion cannot quietly
break the ordinary refuses-HEAD origin. Verified by putting 405 back and
watching the new arm redden while the control stayed green.

**The install-gate anchor went stale for the third time**, and is dealt with
above by sequencing rather than by another number.

## Iteration 25

**An em dash reached a file, which is the one style rule Josh has.** One
literal U+2014, in the iteration-24 entry of this plan. Fixed.

🛑 **My check did not miss it. I never read the check.** I had put the em-dash
verification in the same command block that launched the background gate, so its
output went into the background task's stream rather than to me. **Running a
check is not reading it**, and a check whose output you do not see is worth
exactly nothing. Verified afterwards across all four files I have touched, all
six spellings, with a hyphen control: the plan is clean, and my 259 added lines
in the installer carry zero (the file's 11 are identical to main's, so this
branch introduced none).

**The design rationale quoted a sentence the code no longer prints.** Both
asymmetry comments said a false NO "blocks the install outright behind Check
your internet connection". Since the status-2 change that is no longer true for
a false NO from the TYPE rule: the origin answered, so it returns 2 and prints
the not-usable copy. The connection sentence is reachable only via status 1. The
argument survives; only the quoted cost was stale.

**A comment naming a call site by distance was wrong, twelve lines below the
rule forbidding exactly that.** It said "twenty lines below"; it is 82. Now
named by its surrounding code, which is the rule the same block states.

**The range arm's lack of a 405 carve-out is deliberate and now says so.** On
HEAD a 405 is about the METHOD. On the range GET the request named the artifact,
so any 4xx is an answer about it: a 416 from a zero-length object means the file
exists and is unusable, which is what status 2 says. Written down because the
next reader will otherwise "make the two arms consistent" and reintroduce the
iteration-24 bug backwards.

**The status-2 copy was a single 282-character info line**, the longest in the
file, rendering as four ragged lines on an 80-column terminal while the sibling
failure copy above it already split. Now three semantic lines.

**The floor-OS arm is gated, and the gate speaks.** Two reviewers raised it; I
deferred it in iteration 18 on the grounds that a silent skip trades a
hypothetical red for coverage quietly lost. It now skips only below curl 8.4.0
and prints the full reason when it does. Verified both arms: it runs here on
8.7.1, and simulating 8.1 produces a skip carrying its explanation.

## Iteration 26

**I stopped deferring the file:// sentence, because three separate reviewers had
now found it.** Iterations 23, 24 and 26 each raised that a missing local path
gets copy naming a still-publishing release and an intercepting network, when
there is no release and no network. I fixed the opening in 23 and left the
causes, which addressed the assertion and not the falsehood.

⭐ **A deferral that survives three independent findings is not a judgement
call any more.** My reason each time was risk: the guard harness executes the
shipped block verbatim, so a third status plus a helper rewrites both the block
and the extractor late in a long loop. That reason was true and it stopped being
sufficient somewhere around the second reviewer.

Done now, in full:

- `rc 37` returns its own status 3 on both probe arms.
- The refusal moved into `_reachable_refuse`, one copy, branching three ways.
- Each guard went from 14 lines to 5, and the duplicated user-facing copy is
  gone, which is what four reviewers had been asking for.
- Status 3 says: *the download at X is not there / That path does not exist or
  cannot be read. Check the address it is installing from.* No server, no
  release, no network.

**The harness needed teaching, and this is the part that would have failed
silently.** It extracts the guard and executes it with `reachable()` stubbed.
Once the copy moved into a helper, the extracted block called a function the
harness had never defined, so the arms would have seen empty output rather than
a wrong sentence. It now extracts `_reachable_refuse` verbatim too, by the same
idiom as `reachable()`, so the arms still run the SHIPPED text.

Verified by perturbation, both halves: removing the status-3 return reddens the
file:// arm, and making the status-3 copy blame the network reddens the sentence
arm. Five arms broke during the refactor and each was a real signal about what I
had just moved.

**And I made the distance-reference error again, inside the comment about not
making it.** Iteration 25 replaced "twenty lines below" (actually 82) and I
wrote "twelve lines above" for the rule itself, which was wrong by three. Now
named by its anchor. A distance in a comment is wrong the moment anyone edits
above it, which is the entire reason the rule exists, and I have now proved that
twice in two iterations.

## Iteration 27

**My iteration-26 change made one of my own rationales false, and it took a
reviewer to see it.** The assertion "the refusal must not say the server
answered" was added when curl 37 still landed on status 2, where claiming a
server had answered was simply false. Giving rc 37 its own status 3 removed that
premise: status 2 is now reached only from rc 0 or a code at or above 400, and
both of those mean a server really did answer. The comment still cited curl 37,
and contradicted itself twelve lines later where a sibling assertion is
justified with "the server DID answer".

✅ **I removed the assertion rather than re-justifying it.** The honest options
were to keep it on weaker grounds or to delete it, and re-justifying a guard on
grounds other than the ones it was written for is how a suite fills with
assertions nobody can explain. The check that survives is that the copy opens on
the address, which is a property of the copy rather than of the vanished
premise.

**The helper I extracted last iteration had no extraction guard, and its failure
mode is a misdiagnosis.** `FN`, `GUARDS` and `PROBE` each assert they matched;
`REFUSE` did not. If its shape moves, `REFUSE[0]` is undefined, the harness gets
a literal `undefined` line, `sh` dies, and every guard arm then reports "the
guard fired but said nothing", which reads as a broken guard rather than a
broken extractor. Verified: breaking the regex now reddens the named arm first,
so the diagnosis points at the extractor.

**Two comments still described the call sites in the shape this branch
replaced.** One said the guards are `if ! reachable "$url"`; they capture the
status with `|| _r_why=$?`. Another said all three sites are `if`/`&&`
conditions; two are now `||` lists. The conclusion in both cases still held and
only the description had rotted, which is the exact failure the surrounding
paragraph argues against.

⭐ **Three iterations running, the finding has been that a change of mine
invalidated a claim elsewhere that nothing checks.** A false comment costs
nothing until someone believes it, which is precisely when it costs the most.

## Iteration 28: converged

Zero BLOCKERs, zero WARNINGs, zero CONVENTIONs. No unresolved ASKED findings.
Three NITs, deduplicated:

| finding | status |
|---|---|
| status 2 merges the 404 and captive-portal signals | NEW, does not gate |
| the happy path probes the same URL twice | duplicate of iteration 26 |
| comment-to-code ratio in the changed hunk | duplicate of 18, 21, 23, 25, 26 |

The loop converges on ONE iteration with no blocking findings, not on a run of
them, and a confirming pass would be drift rather than rigour. So it is
converged at 28, after 3 BLOCKERs, 30 WARNINGs, 12 CONVENTIONs and roughly 45
NITs across the run.

The reviewer also verified the live origin independently, which is the claim
this whole card rests on:

```
HEAD tmux-arm64.tar.gz        rc=0  200 application/gzip
HEAD kosmos-arm64.tar.gz      rc=0  200 application/gzip
HEAD zzz-cannot-exist.tar.gz  rc=56 404 text/html
```

### The one new NIT, recorded rather than fixed

Status 2 is reached both by an origin answering 2xx with a textual body and by a
hard 404, and its copy offers an intercepting network. A hard 404 is almost
never a captive portal, since portals answer 200 or 302 with their own page, so
that cause is imprecise for the most common half-published shape. A 403 does
plausibly mean a proxy or a private bucket, so the merge is defensible for 4xx
in general and only the 404 arm is loose. `_r_code` is already in hand if a
fourth status is ever wanted.

Not fixed here: it is a NIT, the copy hedges every cause with "may", and adding
a fourth status at the convergence boundary would reopen the loop to validate
one word. Written down as outstanding, and this time it says outstanding rather
than describing something already shipped.

### Self-audit before the reviewer, for once

Three consecutive iterations had found a claim of mine that a later change of
mine had falsified, so I swept the plan for the rest instead of waiting. Two:
the "considered and not done" section still presented status 3 and the refusal
helper as an outstanding follow-up when iteration 26 shipped both, and it named
the helper `_reachable_refusal` when the shipped one is `_reachable_refuse`, so
that name never named anything.

⭐ The habit that generalises: after changing behaviour, grep the plan for the
shape you just replaced. The loop found this class four times; I found it once.
