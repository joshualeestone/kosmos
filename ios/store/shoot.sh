#!/bin/bash
# NOT THE STORE SET any more (#6262): ios/store/shoot-app.sh takes that from the app itself, at the required
# sizes. This one still shows the board's phone layout in a desktop WebKit, and files into the folder you name
# (or a new temp folder, printed), never into ios/store/screenshots/.
#
# It shoots the board UI on a throwaway board seeded with the clean store fleet
# (docs/browser-checks/mobile-shots.js --data store) at 1320x2868, in WebKit, light
# and dark, drops the alpha channel, and files each shot as <out>/<theme>/NN-name.png.
#
# WebKit is an engine approximation of the iPhone app's web view, not the app.
# It is a heavy run: pass the fleet heavy-run gate before starting it.
#
# Usage: NODE_PATH=$HOME/work/pw-runtime/node_modules ios/store/shoot.sh [out-dir]
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

out="${1:-$(mktemp -d "${TMPDIR:-/tmp}/ios-webkit-shots-XXXXXX")}"
python3 - "$raw" "$out" "$here/screenshots" "${order[@]}" <<'PY'
import sys, os, glob
from PIL import Image
raw, dest, store, order = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
# Never into the store set, including a folder there that does not exist yet (realpath needs no folder).
d, st = os.path.realpath(dest), os.path.realpath(store)
if d == st or d.startswith(st + os.sep):
    sys.exit('not into the store set (ios/store/screenshots); the store set comes from shoot-app.sh')
themes = ('light', 'dark')
srcs = {(t, n): os.path.join(raw, f'{n}--appstore--{t}--webkit.png') for t in themes for n in order}
missing = [s for s in srcs.values() if not os.path.exists(s)]
if missing:
    sys.exit('missing shots, nothing filed: ' + ', '.join(os.path.basename(m) for m in missing))
# Flatten every shot into a staging folder first; the committed set is touched
# only once all of them were written.
stage = os.path.join(raw, 'filed')
for theme in themes:
    os.makedirs(os.path.join(stage, theme))
    for i, name in enumerate(order, 1):
        im = Image.open(srcs[(theme, name)]).convert('RGBA')
        flat = Image.new('RGB', im.size, (255, 255, 255))
        flat.paste(im, mask=im.split()[3])
        flat.save(os.path.join(stage, theme, f'{i:02d}-{name}.png'), optimize=True)
for theme in themes:
    d = os.path.join(dest, theme)
    os.makedirs(d, exist_ok=True)
    for old in glob.glob(os.path.join(d, '*.png')):
        os.remove(old)
    for f in sorted(os.listdir(os.path.join(stage, theme))):
        os.replace(os.path.join(stage, theme, f), os.path.join(d, f))
        print('filed', f'{theme}/{f}', Image.open(os.path.join(d, f)).size)
PY
[ $? = 0 ] || { echo "VERDICT: FAIL (filing the shots failed)"; exit 1; }
echo "filed under $out"
echo "VERDICT: PASS"
