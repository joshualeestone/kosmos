# buildpaths-6549: the bundle never names the build Mac's home folder, and shipped comments name no real people (#6549)

From the #1760 shipped-artifact pass on staging 0.7.58: the connector held the build Mac's home path 898 times (its
compiler's source paths), and shipped source comments named a few internal people's folders and quoted a garbled real
email. The connector half is kosmos-relay remap-6549 (the build remaps those paths; measured 0 in both slices vs 878).

## Change
- tools/lib/home-path-gate.sh: `home_path_gate_tree <stage> [<home>]` reads every staged file under app/ and bin/ as
  bytes (binary or text; the upstream Node runtime is not ours to rebuild and is skipped) for the build user's home
  folder with a trailing slash, prints each offending file and returns 1. An unusable home (empty, relative, `/`,
  one component) or a stage with no app/ or bin/ is refused, never skipped.
- tools/build-kosmos-bundle.sh: runs the gate right after the deployment-floor gate, so a release refuses before
  packing.
- Comments: 11 examples in server.js, web/index.html, engine/discover.js, engine/status.js and engine/trust.js use
  made-up names (sam, alex, sampatel) instead of real ones. One was also wrong as an example: `/Users/agentine` does
  not start with `/Users/agent1`; `/Users/alexandra` does start with `/Users/alex`.

## Test
tools/test-home-path-gate-6549.sh, on a fake stage and a fake home: CONTROL a clean stage passes; a binary naming the
home is refused and named; a source comment naming it is refused; runtime/ is not read; `/Users/zz-builderother` is
not a hit for `/Users/zz-builder`; an empty $HOME, `/`, a relative home and `/Users` are refused; a stage with no app/
is refused.

## Order
kosmos-relay remap-6549 must merge FIRST: until the connector is rebuilt with it, this gate refuses the cut. The build
script is a connector input (agent-workforce tools/lib/connector-currency.sh), so the next cut's step 1d sees the
connector as stale and rebuilds it.

## Not changed
Test files that still quote the old names: they do not ship (the bundle copies only non-test engine files).

## Weakest premise
That nothing else staged legitimately contains the build user's home path. A local or CI build from a checkout under
$HOME could stage such a file (the shipped Swift app embeds no source path, measured: 0 `main.swift` strings). If one
does, the gate refuses that build loudly, which is the safe direction.
