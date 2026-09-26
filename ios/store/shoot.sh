#!/bin/bash
# Takes the iOS App Store screenshots (#718): the real board UI on a throwaway
# board seeded with the clean store fleet (docs/browser-checks/mobile-shots.js
# --data store), at the 6.9-inch iPhone size App Store Connect requires
# (1320x2868), in WebKit, light and dark. Then drops the alpha channel (App
# Store Connect rejects it) and files each shot as screenshots/<theme>/NN-name.png.
#
# WebKit is an engine approximation of the iPhone app's web view, not the app.
# It is a heavy run: pass the fleet heavy-run gate before starting it.
#
# Usage: NODE_PATH=$HOME/work/pw-runtime/node_modules ios/store/shoot.sh
# Ends with one VERDICT: line; no verdict line means it did not finish.
set -u -o pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
raw="$(mktemp -d "${TMPDIR:-/tmp}/ios-store-shots-XXXXXX")"
trap 'rm -rf "$raw"' EXIT

# Store order: what a buyer sees first comes first.
order=(home push-landing agent-chat project-room)
screens="$(IFS=,; echo "${order[*]}")"

node "$repo/docs/browser-checks/mobile-shots.js" --out "$raw" --data store --scale device \
  --sizes appstore --engines webkit --themes light,dark --screens "$screens"
rc=$?
if [ "$rc" != 0 ]; then echo "VERDICT: FAIL (mobile-shots exited $rc; nothing filed)"; exit 1; fi
# A page that threw while rendering is not a store picture either.
if grep -q '| ERROR\|OVERFLOW\|page error' "$raw/report.md"; then
  grep 'ERROR\|OVERFLOW\|page error' "$raw/report.md"
  echo "VERDICT: FAIL (a shot errored or overflowed; nothing filed)"; exit 1
fi

python3 - "$raw" "$here/screenshots" "${order[@]}" <<'PY'
import sys, os, glob
from PIL import Image
raw, dest, order = sys.argv[1], sys.argv[2], sys.argv[3:]
themes = ('light', 'dark')
srcs = {(t, n): os.path.join(raw, f'{n}--appstore--{t}--webkit.png') for t in themes for n in order}
missing = [s for s in srcs.values() if not os.path.exists(s)]
if missing:
    sys.exit('missing shots, nothing filed: ' + ', '.join(os.path.basename(m) for m in missing))
for theme in themes:
    d = os.path.join(dest, theme)
    os.makedirs(d, exist_ok=True)
    for old in glob.glob(os.path.join(d, '*.png')):
        os.remove(old)
    for i, name in enumerate(order, 1):
        src = srcs[(theme, name)]
        im = Image.open(src)
        flat = Image.new('RGB', im.size, (255, 255, 255))
        flat.paste(im.convert('RGBA'), mask=im.convert('RGBA').split()[3])
        out = os.path.join(d, f'{i:02d}-{name}.png')
        flat.save(out, optimize=True)
        print('filed', os.path.relpath(out, os.path.dirname(dest)), flat.size)
PY
[ $? = 0 ] || { echo "VERDICT: FAIL (filing the shots failed)"; exit 1; }
echo "VERDICT: PASS"
