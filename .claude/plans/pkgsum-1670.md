# pkgsum-1670: the pkg verifies the installer before running it

kosmos#1670.

## Problem

`install/pkg-scripts/postinstall:145` did:

```sh
exec /usr/bin/curl -fsSL "$0" | /bin/sh      # $0 = https://installkosmos.com/setup
```

We publish `setup.sha256` and **nothing machine-side read it**. Every consumer in the repo is a producer or a release-time checker; no install path verified anything. That is why #1666 survived a whole day: the published checksum did not match the served bytes and no machine was looking.

## Why the pkg specifically, and why the terminal path is left alone

`curl | sh` **cannot** verify itself. You would have to fetch the thing to check the thing, over the same channel, so there is no independent anchor. That limit is real and this PR does not fight it.

The pkg is different: it carries a **stapled Apple notarisation ticket**, so it reached the machine through a channel independent of the HTTPS fetch it then performs. **It is the one install path with a real trust anchor and it was the least verified one.**

## Premise measured before writing code

I said on the card that if `setup.sha256` is not actually published beside `setup`, the fix is unbuildable as described. Measured, with a must-fail control:

```
/setup                     200 text/plain             201,025 b
/setup.sha256              200 application/octet-stream    72 b
/setup.sha256-zzz-...      404                              <- control
published sha == served sha   MATCH
```

Buildable, and the anchor is correct today.

## Change

Fetch `setup` to a temp dir, fetch `setup.sha256`, compare, and **run only on a match**.

### The decision worth arguing with: an ABSENT checksum also refuses

The card says "refuse on mismatch" and is silent on unreachable. I made it refuse on both, and the reason is the threat model rather than caution:

- **An origin that can serve you bad bytes can serve you a matching checksum.** So this buys nothing against a *malicious* origin and I do not claim it does.
- What it buys is protection against a **half-published or misconfigured** origin, which is exactly the state we were in for a day.
- **A missing `.sha256` is a symptom of that same half-published state**, not an unrelated blip.
- Proceeding without the anchor would make the pkg path no better than the terminal one, which is the whole argument of the card.

The two cases get **different sentences**, because the right advice differs: an absent checksum says a retry is safe; a mismatch says report it rather than retrying, because a mismatch does not fix itself.

## Verification

`tools/test-pkg-checksum-1670.sh`, ten checks, run against a **real local origin with real curl**, because the verification calls `/usr/bin/curl` by absolute path and cannot be stubbed via `PATH`.

| arm | result |
|---|---|
| matching checksum | runs the installer |
| mismatched | refuses, does not run, says why, does not suggest a retry |
| absent | refuses, does not run, distinct sentence, says a retry is safe |
| control | the harness can detect a real run |

**Perturbation:** reverting the postinstall makes the mismatch arm report `rc=0, ran=yes` (it executed an installer whose checksum did not match), while the "matching checksum runs it" arm **stays green**. A control that does not move under the perturbation.

Suite: **exit code 0**, 3260 pass, 0 fail, 0 shell FAIL lines, and the new shell test is confirmed to have actually executed inside the suite rather than merely to exist.

## Two traps hit while building it, recorded because they are reusable

- **`sh -c 'script' a b` sets `$0` to `a`; `sh script a b` sets `$0` to the file.** The postinstall relies on the first. My harness used the second, so curl received a path, and **two refusal arms passed for the wrong reason** (refusing on a download failure rather than on the checksum). Only the control caught it.
- **`python3 -m http.server` buffers its port line when stdout is not a tty**, and binds `::` by default. Both had to be fixed (`-u`, `-b 127.0.0.1`) or the harness polls an empty file.
