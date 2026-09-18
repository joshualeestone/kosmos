# 3230-installer-wording -- set the download expectation on the installer success pane

Addresses kosmos#3230.

## Problem

The macOS .pkg success pane (`install/pkg-resources/conclusion.html`) tells the
person Kosmos is installed and how to reopen it, but says nothing about the large
provider-tool download that happens later. The first time a person connects an
agent, Kosmos downloads the terminal agent it needs (Claude Code is roughly a
couple of hundred megabytes). A download of that size with no prior mention is
alarming, and the success pane is the natural place to set the expectation.

## Change

Add one paragraph to `install/pkg-resources/conclusion.html`, after the existing
two body paragraphs:

> The first time you connect an agent, Kosmos downloads the tools it needs. That
> can be a few hundred megabytes and take a few minutes on a new machine, and
> Kosmos asks before it starts.

## Intent (fixed)

Honestly set the expectation that connecting the first agent triggers a large
download that asks first, without undercutting that the install succeeded and
without alarming the person. The exact wording may be refined; the intent is not.

## Why this is honest about the mechanism

The provider-tool download is user-initiated at Connect with a confirm step, not
automatic at install. `engine/setup-assistant.js` shows the confirm dialog before
any download starts, and `engine/connect.js` / `engine/runners.js` only fetch a
runner when it is not already present. So "the first time you connect an agent"
and "Kosmos asks before it starts" are both accurate.

## Scope / what this does NOT touch

- Not the in-app progress bar (owned separately).
- Not `engine/connect.js` completion logic (out of scope, honest already).
- One file only: `install/pkg-resources/conclusion.html`.

## Validation

- Full `yarn test` suite (no test asserts specific conclusion.html body content;
  the only related test asserts that editing the Conclusion screen changes its
  sha, which this change satisfies).
- `/challenge-loop` to convergence.
