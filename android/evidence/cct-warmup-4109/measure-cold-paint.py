#!/usr/bin/env python3
"""#4109: cold sign-in paint, measured the way android/evidence/moto-g-play-2024-4090/README.md did.

For each run: force-stop io.kosmos.app and com.android.chrome, wait two seconds, start the
launcher with `am start -W`, and poll screenshots until a fixed crop around the "Sign in to
Kosmos+" heading matches the reference frame. The paint time is from just before `am start` to
the start of the first matching capture, so it is read to the nearest capture interval (a few
hundred milliseconds on the emulator), exactly as the #4101 README warns.

  python3 measure-cold-paint.py <apk> <label> [runs=7]

One unmeasured launch follows the install (first launch after an install compiles the app).
Writes <label>.tsv and <label>-cold-<n>.png (the matching frame) next to this script, and prints
each run and the median. A run that never matches within the timeout is reported as a miss and
the script exits non-zero: a median over missing runs would be precise and false.
"""
import io
import os
import statistics
import subprocess
import sys
import time

from PIL import Image, ImageChops, ImageStat

ADB = os.environ.get('ADB', '/opt/homebrew/share/android-commandlinetools/platform-tools/adb')
HERE = os.path.dirname(os.path.abspath(__file__))
REFERENCE = os.path.join(HERE, '..', 'moto-g-play-2024-4090', 'api35-signin.png')
CROP = (60, 580, 400, 635)       # the "Sign in to Kosmos+" heading at 720x1600
MATCH_BELOW = 12.0                # mean absolute difference per channel, 0..255
TIMEOUT_S = 25.0
COMPONENT = 'io.kosmos.app/io.kosmos.app.KosmosLauncherActivity'


def adb(*args, **kw):
    return subprocess.run([ADB, *args], capture_output=True, **kw)


def capture():
    out = adb('exec-out', 'screencap', '-p').stdout
    return Image.open(io.BytesIO(out)).convert('RGB')


def distance(img, ref_crop):
    diff = ImageChops.difference(img.crop(CROP), ref_crop)
    return sum(ImageStat.Stat(diff).mean) / 3


def one_run(ref_crop, keep=None):
    adb('shell', 'am', 'force-stop', 'io.kosmos.app')
    adb('shell', 'am', 'force-stop', 'com.android.chrome')
    time.sleep(2)
    t0 = time.monotonic()
    start = subprocess.Popen([ADB, 'shell', 'am', 'start', '-W', '-n', COMPONENT],
                             stdout=subprocess.PIPE, text=True)
    first_d = None
    while time.monotonic() - t0 < TIMEOUT_S:
        t = time.monotonic()
        img = capture()
        d = distance(img, ref_crop)
        if first_d is None:
            first_d = d
        if d < MATCH_BELOW:
            out = start.communicate(timeout=30)[0]
            if keep:
                img.save(keep)
            return round((t - t0) * 1000), first_d, d, parse_times(out)
    start.communicate(timeout=30)
    return None, first_d, None, {}


def parse_times(out):
    times = {}
    for line in out.splitlines():
        k, _, v = line.partition(':')
        if k.strip() in ('TotalTime', 'WaitTime', 'LaunchState'):
            times[k.strip()] = v.strip()
    return times


def main():
    apk, label = sys.argv[1], sys.argv[2]
    runs = int(sys.argv[3]) if len(sys.argv) > 3 else 7
    ref_crop = Image.open(REFERENCE).convert('RGB').crop(CROP)
    r = adb('install', '-r', apk, text=True)
    if r.returncode != 0:
        sys.exit(f'install failed: {r.stdout}{r.stderr}')
    one_run(ref_crop)   # unmeasured: first launch after install
    rows, missed = [], 0
    for n in range(1, runs + 1):
        paint, first_d, d, times = one_run(ref_crop, os.path.join(HERE, f'{label}-cold-{n}.png'))
        if paint is None:
            missed += 1
        rows.append((n, times.get('LaunchState', ''), times.get('TotalTime', ''),
                     times.get('WaitTime', ''), paint, round(first_d, 1), d if d is None else round(d, 1)))
        print(label, *rows[-1], sep='\t', flush=True)
    with open(os.path.join(HERE, f'{label}.tsv'), 'w') as f:
        f.write('run\tlaunch_state\ttotal_ms\twait_ms\tpaint_ms\tfirst_frame_distance\tmatch_distance\n')
        for row in rows:
            f.write('\t'.join('' if v is None else str(v) for v in row) + '\n')
    if missed:
        print(f'{label}: {missed} run(s) never matched; no median reported', flush=True)
        sys.exit(1)
    print(f'{label}\tmedian_paint_ms\t{statistics.median(r[4] for r in rows)}', flush=True)


if __name__ == '__main__':
    main()
