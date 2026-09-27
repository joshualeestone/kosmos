# #4109: warming the browser before the TWA opens

Cold sign-in paint on the API 35 Moto AVD (`moto-g-play-2024-api35`: 720x1600, 268 dpi, 4 GB,
2 cores, host GPU, Chrome 124.0.6367.219), before and after `KosmosLauncherActivity` binds to the
browser and calls `warmup` first thing (see `android/README.md`, Browser warmup).

## Result

**The warmup saves roughly 0.1 to 0.25 s of a roughly 1.3 to 1.6 s cold sign-in paint on this
emulator.** That is consistent across two sessions but far below #4105's 0.5 to 1.2 s estimate.
The physical Moto (#4090) is the real bar and has not been measured.

| Session | Main (no warmup) | With warmup | Change |
|---|---:|---:|---:|
| 1: arms in sequence, 7 runs each | 1303 ms, and 1350 ms re-run last | 1212 ms (bind + warmup), 1201 ms (plus `mayLaunchUrl`) | about -100 ms |
| 3: main and the final build alternated, 3 rounds of 7 each, all runs | 1618 ms (19 runs, plus 2 that never painted within 25 s) | 1337 ms (21 runs) | about -280 ms |
| 3: only runs with a capture interval of 150 ms or less | 1477 ms (9 runs) | 1255 ms (12 runs) | about -220 ms |

The 150 ms cut was chosen after seeing session 3's data, so the all-runs row is the headline. The
cut only shows the same direction on the runs the machine's load did not distort: in that set the
slowest warm run (1413 ms) is slower than only one main run (1406 ms).

**`mayLaunchUrl` adds nothing measurable** (1201 against 1212 ms, inside one capture interval) and
was removed; `android/README.md` says why it cannot help from a separate session and must not be
put on the launch session.

**No connection leaked:** `logcat` showed 0 "has leaked ServiceConnection" lines across session 3's
42 launches.

## The 3.5 s figure (#4090)

Session 2 was a control: the exact APK #4101 measured (sha256 `04e1bd7d...`, stock
`LauncherActivity`) painted in **1448 ms** (median of 7) on this harness and AVD, not #4101's
3508 ms. Only the APK changed between it and today's main, so the 3.5 s came from #4101's harness
or that day's AVD state, not the app. Recorded on #4090.

## Load

The heavy gate keeps release and browser-check runs off the machine, but not everything: in
session 3, round c of main ran while two site deploys ran and `fseventsd` took most of a core
(load average 16), and its capture interval rose from about 125 ms to 250 to 750 ms. Two of those
runs never reached the sign-in page within 25 s. Session 2's main arm (1884 ms) shows the same
effect. Compare numbers only within a session, and read `capture_interval_ms` and `total_ms`
(Android's own activity start) as the load signal for each run.

## Method

`measure-cold-paint.py` follows #4101's written method, because #4101's harness was not committed
and its crop was not recorded: force-stop `io.kosmos.app` and `com.android.chrome`, wait 2 s,
`am start -W`, then poll `screencap` until a fixed crop of the "Sign in to Kosmos+" heading matches
#4101's own reference frame (`../moto-g-play-2024-4090/api35-signin.png`). The paint time runs from
just before `am start` to the start of the first matching capture, so it is known only to within
one capture interval. One unmeasured launch follows each install. The first frame of every run is
checked not to match (column `first_frame_distance`, 49.1 on every run that painted), so a
match is never the splash.

The runners (`run-all.sh`, `run-control.sh`, `run-abab.sh`) gate every arm on
`tools/heavy-gate.sh --twice`. Their logs are the `.log` files; per-run numbers are the `.tsv`
files; the first matching frame of each arm is kept as `<arm>-cold-1.png` (`main-c`'s first run
never painted, so it has none).

Provenance: session 1's `before`, `bindonly`, `bindpreload` and `before2` files were written by the
harness as of commit 997121cc2, which had no `capture_interval_ms` column; sessions 2 and 3 used the
later harness with it. The APKs measured are not committed (release-signed with the upload key):
main `f78a9137...` (built from ee8836281), bind only `71bea261...`, bind plus `mayLaunchUrl`
`7a55b8c1...`, the final build `fdde2d62...` (06fb24de6), and #4101's `04e1bd7d...`. The scripts
name the paths they were run from on the Mortals Mac.

## Not measured

- The physical Moto G Play 2024 (#4090): emulator browser start is not the phone's.
- A cold HTTP cache or a real phone network: force-stop keeps Chrome's disk cache, and the
  emulator reaches `login.kosmosplus.com` over the host's network.
