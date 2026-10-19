# buildpaths-6549: the bundle never names the build Mac's home folder, and shipped comments name no real people (#6549)

From the #1760 shipped-artifact pass on staging 0.7.58: the connector held the build Mac's home path 898 times (its
compiler's source paths), and shipped source comments named a few internal people's folders and quoted a garbled real
email. The connector half is kosmos-relay remap-6549 (the build remaps those paths; measured 0 in both slices vs 878).

## Change
- tools/lib/home-path-gate.sh `home_path_gate_tree <stage> [<home>]`, two checks (the upstream Node runtime skipped):
  1. every file under app/ and bin/, as bytes, for THIS build user's home folder followed by anything that cannot
     continue a folder name or by the end of a line, in any case (review 1: the first version needed a trailing `/`
     and missed `path.relative('/Users/x', p)`; macOS volumes ignore case);
  2. every compiled (Mach-O, by its first four bytes) file under app/bin/ and the app's Contents/MacOS/ for ANY
     account's build folders (/Users/<name>/.cargo/, .rustup/, work/), because the connector may be built on another
     Mac (review 1). Scripts in app/bin/ are left to check 1 (review 3: a placeholder comment there must not refuse a
     cut). Measured on the real connectors with an unrelated home: the old one is refused, the remapped one passes.
  It refuses an unusable home, a missing app/ or bin/, a file grep cannot read (review 1: rc > 1 is a refusal), and a
  symlink in the stage, which grep -r would not read through (review 2; the build stages none, measured on 0.7.58).
- tools/build-kosmos-bundle.sh runs it after the deployment-floor gate; the test checks that call is still there.
- package.json test:shell runs the new test (review 1: tools.every-test-runs refused it as an orphan).
- Comments: the places in shipped files (server.js, web/index.html, engine/*.js, bin/) that named real people, the
  build Macs' accounts, or the build Mac's host name (Agent1s, 11 comments) now use placeholders no Mac would have as
  an account (`example`, `exampleuser`, `example-person`; review 2), so the names this change writes cannot make the gate
  refuse a build Mac that has one (older placeholders such as /Users/alice and /Users/pat still ship and would refuse a
  Mac with those accounts; neither build Mac has one), `<user>` where the comment records a measurement (a made-up name there
  would falsify the record), or "a build Mac". One example was also wrong: `/Users/agentine` does not start with
  `/Users/agent1`; `/Users/exampleuser` does start with `/Users/example`.

## Test
tools/test-home-path-gate-6549.sh (fake stage and fake home), run by package.json test:shell. CONTROL a clean stage
passes. Refused: a binary or a comment naming the home; the home followed by a quote or a NUL; in another case; given
with trailing slashes; found AND NAMED through the default $HOME (the build's own call; CONTROL a clean stage passes
under it); at the very end of a line; a home with a dot and a plus found
literally; another account's .cargo/ or work/ in a compiled file (64-bit and universal headers); an unreadable file;
a symlink; an unusable home (empty $HOME, `/`, `//`, `/Users`, `/Users/`, relative); no app/ or no bin/. Not refused:
runtime/; `/Users/zz-builderother`; `/Users/joXhnnx` for `/Users/jo.hn+x` (no wildcards); a made-up build folder in
a source comment or in a script under app/bin/. A `|` in a file name is still named. The build still calls the gate.
Mutants (review 4, and mine for the regex arms): each fix removed turns its arm red.
Measured on stages built from the sources: this branch passes for /Users/agent1, /Users/mortalkombat, /Users/josh,
/Users/joshu, /Users/sam and /Users/alex; CONTROL main's server.js and status.js are refused for /Users/agent1 and /Users/josh, files named.

## Order
kosmos-relay remap-6549 must merge FIRST. Its change to tools/build-tunnel-release.sh is a connector input
(tools/lib/connector-currency.sh CONNECTOR_TUNNEL_INPUTS), so the next cut's step 1d REFUSES the old connector as
stale before the bump and a person rebuilds it (review 1 corrected this plan: 1d refuses, it does not rebuild). With
KOSMOS_ALLOW_STALE_TUNNEL=1 the old connector gets past 1d and this gate refuses it at step 4.

## Not changed
- engine/feedguard.js DEFAULT_DENY_NAMES holds Josh's real name and GitHub account as CODE (review 2): it is the
  deny-list that stops agents posting his name to the community, so it has to ship. Kept, knowingly.
- `joshualeestone/kosmos-catalogue` and `/kosmos-community` in comments: public repository owners, structural.
- The host name "Mortals" in about 20 comments (review 3): unlike "Agent1s", it does not contain its Mac's account
  name, which is what this card is about. "Josh" in comments: the product owner's first name, in quoted rulings.
- Test files that still quote the old names: they do not ship (the bundle copies only non-test engine files).
- Review 1 NIT, deferred: the tarball records the build account as each entry's owner (`agent1 staff`). Changing the
  owner fields is a different risk (an extraction as root would apply them), so it is not done here.

## Weakest premise
That nothing else staged legitimately contains the build user's home path. A local or CI build from a checkout under
$HOME could stage such a file (the shipped Swift app embeds no source path, measured: 0 `main.swift` strings). If one
does, the gate refuses that build loudly, which is the safe direction.
