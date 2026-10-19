#!/bin/bash
# Checks ios/store/listing.md against App Store Connect's field limits, and
# checks the screenshots against the sizes App Store Connect takes, with no alpha channel.
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

if [ -z "$(field copyright)" ]; then echo "FAIL  copyright: missing or empty"; fail=1; else echo "ok    copyright: $(field copyright)"; fi

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

# Screenshots: each set is a folder under screenshots/ named <size>-<theme>, holding 1 to 10 PNGs with no alpha
# channel, every one a portrait size App Store Connect takes for that display (developer.apple.com, App Store
# Connect help, "Screenshot specifications", read 2026-10-17):
#   6.3  iPhone with Dynamic Island, medium display: 1206x2622 or 1179x2556. REQUIRED: at least one set.
#   6.9  iPhone with Dynamic Island, large display: 1320x2868, 1290x2796 or 1260x2736. Optional.
sets=0; required=0
for d in "$here"/screenshots/*/; do
  [ -d "$d" ] || continue
  set_name="$(basename "$d")"; sets=$((sets + 1)); count=0
  case "$set_name" in
    6.3-light|6.3-dark) sizes="1206x2622 1179x2556" ;;
    6.9-light|6.9-dark) sizes="1320x2868 1290x2796 1260x2736" ;;
    *) echo "FAIL  screenshots/$set_name: not a set this listing takes (6.3-light, 6.3-dark, 6.9-light or 6.9-dark)"; fail=1; continue ;;
  esac
  for s in "$d"*.png; do
    [ -e "$s" ] || continue
    count=$((count + 1))
    w=$(sips -g pixelWidth "$s" | awk '/pixelWidth/{print $2}')
    h=$(sips -g pixelHeight "$s" | awk '/pixelHeight/{print $2}')
    a=$(sips -g hasAlpha "$s" | awk '/hasAlpha/{print $2}')
    name="$set_name/$(basename "$s")"
    case " $sizes " in
      *" ${w}x${h} "*) if [ "$a" = no ]; then echo "ok    $name: ${w}x${h}, alpha $a"
                       else echo "FAIL  $name: has an alpha channel"; fail=1; fi ;;
      *) echo "FAIL  $name: ${w}x${h} (want one of: $sizes)"; fail=1 ;;
    esac
  done
  if [ "$count" -lt 1 ] || [ "$count" -gt 10 ]; then echo "FAIL  $set_name: $count screenshots, App Store Connect takes 1 to 10"; fail=1
  else case "$set_name" in 6.3-*) required=$((required + 1)) ;; esac; fi
done
if [ "$sets" = 0 ]; then echo "FAIL  no screenshot sets under $here/screenshots"; fail=1; fi
if [ "$required" = 0 ]; then echo "FAIL  no 6.3-inch set: App Store Connect requires the medium Dynamic Island size"; fail=1; fi

if [ "$fail" = 0 ]; then echo "VERDICT: PASS"; else echo "VERDICT: FAIL"; fi
exit "$fail"
