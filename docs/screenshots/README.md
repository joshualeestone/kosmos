# Emitted, never committed

The render checks under `docs/browser-checks/` write their screenshots
here. The directory is gitignored on purpose, and the reason is a real
incident, not tidiness:

On 2026-08-19, seventeen committed `projects-*.png` in this directory
showed a product that no longer existed: the old product name in the
header, a paragraph Josh had ruled out, a feature marked "isn't built
yet" that had shipped, an em dash the house style bans. The check that
emits them was green the whole time; nothing announces a stale picture
(#126).

A screenshot is a claim with no author and no date on its face. Prose
that goes stale at least reads as prose; a stale screenshot reads as
the current product, which is exactly why it travels further. So the
living source is the render script, run against the tree you are on:

    node docs/browser-checks/render-projects.js   # and its siblings

Plan documents that cite `docs/screenshots/...` paths cite the moment
of their own PR; that is what a plan is, and those references are
history, not links.
