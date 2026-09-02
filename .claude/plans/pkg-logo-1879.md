# Plan: Kosmos app logo on the .pkg installer background (#1879)

## Goal / what "finished" looks like

The macOS Installer for Kosmos shows the Kosmos app logo in the bottom-left of the
installer's left column, like Tailscale, in both light and dark appearance. The logo
uses the app's own rounded-corner squircle. Nothing else about the installer changes.

Done when: the built pkg carries a light and a dark background image, the Distribution
references both, and a release cut rebuilds the pkg so it ships. (A merge is not a
serve; the logo reaches a person only after the next cut serves the rebuilt pkg.)

## Context

Josh, 2026-09-02, after installing Tailscale: the installer has a spot bottom-left for
an app logo, and Kosmos ships none. This is a cosmetic addition to the payload-free
distribution pkg built by `tools/build-installer-pkg.sh`.

## Approach

1. **Art** (`install/pkg-resources/`): crop the gold squircle from the 1024px
   `assets/Kosmos.icns`, resize to a 96px glyph inside a 144px transparent canvas with a
   baked bottom-left margin (so `alignment=bottomleft scaling=none` seats it in the
   corner with a Tailscale-like inset). Two files:
   - `background.png` — light: soft dark drop shadow for lift on the light installer ground.
   - `background-darkAqua.png` — dark: subtle glow so the tile lifts off the dark chrome.
2. **Wiring** (`tools/build-installer-pkg.sh`): add `<background/>` and
   `<background-darkAqua/>` (both `alignment="bottomleft" scaling="none"
   mime-type="image/png"`) to the inline `distribution.xml`. Both keys are required:
   with only `<background/>`, dark-mode installs render no logo.

## Why the input hash matters

`tools/lib/pkg-inputs.sh` hashes `install/pkg-resources/**` and
`tools/build-installer-pkg.sh`. Both the new art and the build-script edit fall inside
that set, so the pkg input sha changes and the release cut's `pkg_publish_needed`
correctly reports the served pkg stale and rebuilds it. No test or guard is bypassed.

## Verification (offline; no sign / notarize / publish)

- `pkgbuild` + `productbuild --distribution ... --resources install/pkg-resources`
  builds an unsigned pkg; confirm both PNGs land in `Resources/` and the Distribution
  carries both background elements.
- Confirm the input sha differs from main, and `tools/test-pkg-input-guard.sh` passes.
- Full node test suite green; subdir-CLAUDE.md audit clean.
- Preview the two PNGs seated bottom-left on light and dark panes.

## Out of scope

- Signing / notarizing / stapling / publishing (happens on the release cut).
- Any change to the welcome/conclusion screens, the postinstall, or setup.sh.
- Retina @2x crispness (installer backgrounds have no @2x mechanism; the soft-edged
  dotted logo tolerates `scaling=none`, matching Tailscale).
