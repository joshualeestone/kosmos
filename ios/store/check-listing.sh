#!/bin/bash
# Checks ios/store/listing.md against App Store Connect's field limits, and
# checks the screenshots against the 6.9-inch iPhone size with no alpha channel.
# Limits: name 30, subtitle 30, promotional text 170, description 4000,
# keywords 100 bytes (Apple counts keyword bytes). Ends with one VERDICT: line;
# no verdict line means it did not finish.
# Usage: ios/store/check-listing.sh [listing.md]
set -u
here="$(cd "$(dirname "$0")" && pwd)"
file="${1:-$here/listing.md}"
fail=0

field() { # print the text between <!-- $1 --> and <!-- /$1 -->, trimmed
  awk -v o="<!-- $1 -->" -v c="<!-- /$1 -->" '$0==c{f=0} f{print} $0==o{f=1}' "$file" \
    | sed -e '1{/^$/d;}' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}'
}

check() { # name limit unit(chars|bytes)
  local v n
  v="$(field "$1")"
  if [ -z "$v" ]; then echo "FAIL  $1: missing or empty"; fail=1; return; fi
  if [ "$3" = bytes ]; then n=$(printf '%s' "$v" | wc -c | tr -d ' ')
  else n=$(printf '%s' "$v" | python3 -c 'import sys; print(len(sys.stdin.read()))'); fi
  if [ "$n" -gt "$2" ]; then echo "FAIL  $1: $n $3, limit $2"; fail=1
  else echo "ok    $1: $n $3 of $2"; fi
}

check name 30 chars
check subtitle 30 chars
check promo 170 chars
check description 4000 chars
check keywords 100 bytes

kw="$(field keywords)"
case "$kw" in *", "*) echo "FAIL  keywords: a space after a comma wastes a byte"; fail=1;; esac

for u in support_url privacy_url marketing_url; do
  v="$(field "$u")"
  case "$v" in https://*) echo "ok    $u: $v";; *) echo "FAIL  $u: not an https URL: $v"; fail=1;; esac
done

# The house rule for anything a person reads: no em dash, in any of the drafts.
for md in "$file" "$here"/*.md; do
  if grep -q $'\xe2\x80\x94' "$md"; then echo "FAIL  $(basename "$md") contains an em dash"; fail=1; fi
done

# Screenshots: each set is a folder under screenshots/ holding 1 to 10 PNGs,
# every one 1320x2868 portrait with no alpha channel.
sets=0
for d in "$here"/screenshots/*/; do
  [ -d "$d" ] || continue
  sets=$((sets + 1)); count=0
  for s in "$d"*.png; do
    [ -e "$s" ] || continue
    count=$((count + 1))
    w=$(sips -g pixelWidth "$s" | awk '/pixelWidth/{print $2}')
    h=$(sips -g pixelHeight "$s" | awk '/pixelHeight/{print $2}')
    a=$(sips -g hasAlpha "$s" | awk '/hasAlpha/{print $2}')
    name="$(basename "$d")/$(basename "$s")"
    if [ "$w" = 1320 ] && [ "$h" = 2868 ] && [ "$a" = no ]; then echo "ok    $name: ${w}x${h}, alpha $a"
    else echo "FAIL  $name: ${w}x${h}, alpha $a (want 1320x2868, alpha no)"; fail=1; fi
  done
  if [ "$count" -lt 1 ] || [ "$count" -gt 10 ]; then echo "FAIL  $(basename "$d"): $count screenshots, App Store Connect takes 1 to 10"; fail=1; fi
done
if [ "$sets" = 0 ]; then echo "FAIL  no screenshot sets under $here/screenshots"; fail=1; fi

if [ "$fail" = 0 ]; then echo "VERDICT: PASS"; else echo "VERDICT: FAIL"; fi
exit "$fail"
