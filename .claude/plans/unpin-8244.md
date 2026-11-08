# unpin-8244: the Linux shell shards back on ubuntu-latest (kosmos#8244, last step)

## Context
#8245 pinned the Linux shell shards to ubuntu-24.04 when ubuntu-latest moved to 26.04 and reddened shell 2/2. #8248
rebuilt tools/test-install-sbroot-6275.sh's negative control so it fails on any mktemp (it passed on real 26.04).
A first unpin, tried in #8248, showed one more 26.04-only red: tools/test-light-side-4911.sh, fixed by PigeonPete in
#8255 (#8250). This branch is pushed only after #8255 is on main.

## Change
.github/workflows/test.yml, linux.yml, tools/test-ci-runner-route-5488.sh and tools/test-ci-created-url-6742.sh restored
to their pre-pin text (c2690b1bf5): `git diff c2690b1bf5` on them is empty. Since then only the pin and the
unpin/revert pair touched them (checked with git log), so this is exactly the unpin.

## Proof
This PR's own CI runs both Linux shell shards on ubuntu-latest (26.04) with both fixes on main. If anything else is red
there, it stays pinned and the new failure gets its own card, rather than widening this PR.
