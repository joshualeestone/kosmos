# #4109: warming the browser before the TWA opens

Cold sign-in paint on the API 35 Moto AVD (`moto-g-play-2024-api35`: 720x1600, 268 dpi, 4 GB,
2 cores, host GPU, Chrome 124.0.6367.219), before and after `KosmosLauncherActivity` binds to the
browser and calls `warmup` first thing (see `android/README.md`, Browser warmup).

## Result

**The warmup takes roughly 0.1 to 0.2 s off a roughly 1.3 to 1.5 s cold sign-in paint on this
emulator**: about -100 ms in session 1, and about -180 ms in session 3 comparing only the rounds
that no outside load reached. That is far below #4105's 0.5 to 1.2 s estimate. The physical Moto
(#4090) is the real bar and has not been measured.

Session 1 ran the arms one after another, 7 cold runs each:

| Arm | Median |
|---|---:|
| main (no warmup) | 1303 ms |
| bind + warmup | 1212 ms |
| bind + warmup + `mayLaunchUrl` | 1201 ms |
| main again, last | 1350 ms |

Session 3 alternated main and the final build, three rounds of 7 cold runs each:

| Round | Main | Warmup | What happened |
|---|---:|---:|---|
| a | 1477 ms | 2242 ms | warmup runs 4 to 7 were loaded (capture interval 264 to 351 ms, `total_ms` up to 1133); its runs 1 to 3 painted at 1170 to 1241 ms |
| b | 1618 ms | 1383 ms | no outside load seen |
| c | 5062 ms (5 runs) | 1263 ms | main was loaded throughout (capture interval 249 to 750 ms); 2 runs never painted within 25 s |
| a+b main against b+c warmup, 14 runs each | 1507 ms | 1326 ms | **-181 ms** |
| all runs | 1618 ms (19, plus 2 misses) | 1337 ms (21) | -281 ms, inflated because main's loaded round was hit harder than the warmup's |

Which rounds count as loaded was judged after seeing the data, from each run's capture interval
and `total_ms`, so the -181 ms figure is a reading of the data, not a pre-registered test. One of
the three rounds (a) went the other way, and it is the one where the warmup arm was loaded.

**`mayLaunchUrl` adds nothing measurable** (1201 against 1212 ms, inside one capture interval) and
was removed; `android/README.md` says why it cannot help from a separate session and must not be
put on the launch session.

**The two runs that never painted** were both main (no warmup): main-c runs 1 and 2, between the
gate reads at 08:29:27Z and 08:32:17Z (session 3's log), in the loaded round. All 21 warmup runs
painted. What their screen showed is not known: this version of the harness kept only matching
frames and no device log. Their first capture was not the usual splash (`first_frame_distance`
101.4 and 57.3, against 49.1 on every run that painted). The harness now keeps the last frame and
the device log's tail for any run that misses.

**Not measured: the unbind.** Every run starts with `am force-stop`, which kills the app without
`onDestroy`, and Browser Helper's launcher stays alive behind the TWA until `onRestart`. So these
runs never exercised the unbind in `onDestroy`, and the `logcat` leak count in `run-abab.sh` could
not have failed. It is not evidence and is not claimed.

## The 3.5 s figure (#4090)

Session 2 was a control: the exact APK #4101 measured (sha256 `04e1bd7d...`, launched through the
stock `LauncherActivity`) painted in **1448 ms** (median of 7) on this harness and AVD, not
#4101's 3508 ms. The harness, the AVD and the boot were the same; the APK and its launch activity
differed, and it ran first after boot, then today's main. So the 3.5 s was not reproduced by the
same app, and it came from #4101's harness or that day's AVD state. Recorded on #4090.

## Load the gate does not see

`tools/heavy-gate.sh` keeps release and browser-check runs off the machine, but not full
validation suites. In session 3's round c, other agents' suites were running (their stubbed
`tools/test-deploy-site-*.sh` tests showed up as `deploy-site.sh`) and `fseventsd` took most of a
core: load average 16.5, main's capture interval up from about 125 ms to 250 to 750 ms. Session
2's main arm (1884 ms) shows the same effect. Compare numbers only within a session, and read
`capture_interval_ms` and `total_ms` (Android's own activity start) as the load signal for each
run. Filed as #4141.

## Method

`measure-cold-paint.py` follows #4101's written method, because #4101's harness was not committed
and its crop was not recorded: force-stop `io.kosmos.app` and `com.android.chrome`, wait 2 s,
`am start -W`, then poll `screencap` until a fixed crop of the "Sign in to Kosmos+" heading matches
#4101's own reference frame (`../moto-g-play-2024-4090/api35-signin.png`). The paint time runs from
just before `am start` to the start of the first matching capture, so it is known only to within
one capture interval. One unmeasured launch follows each install. The first frame of every run is
checked not to match (`first_frame_distance`), so a match is never the splash.

The runners (`run-all.sh`, `run-control.sh`, `run-abab.sh`) gate every arm on
`tools/heavy-gate.sh --twice`. Their output is in `run-all.txt`, `run-control.txt` and
`run-abab.txt`; per-run numbers are the `.tsv` files. One matching frame per arm is kept, the one
from run 1 (`<arm>-cold-1.png`); main-c has none because its run 1 never painted.

Provenance: session 1's `before`, `bindonly`, `bindpreload` and `before2` files were written by the
harness as of commit 997121cc2, which had no `capture_interval_ms` column; sessions 2 and 3 used
the harness as of 06fb24de6. The last-frame and device-log capture on a miss came after all three
sessions. The APKs measured are not committed (release-signed with the upload key): main
`f78a9137...` (built from ee8836281), bind only `71bea261...`, bind plus `mayLaunchUrl`
`7a55b8c1...`, the final build `fdde2d62...` (06fb24de6), and #4101's `04e1bd7d...`. The scripts
name the paths they were run from on the Mortals Mac.

## Not measured

- The physical Moto G Play 2024 (#4090): emulator browser start is not the phone's.
- The unbind in `onDestroy` (see above).
- A cold HTTP cache or a real phone network: force-stop keeps Chrome's disk cache, and the
  emulator reaches `login.kosmosplus.com` over the host's network.
