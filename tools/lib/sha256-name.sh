#!/bin/bash
# Publishing a checksum file under a new name (#930). A `.sha256` carries two
# fields, digest and FILENAME, and `shasum -c` resolves the file from the
# second. release.sh copied the build-local kosmos-arm64.tar.gz.sha256 to the
# versioned name unchanged from 0.5.14 to 0.5.48, so every served
# kosmos-<V>-arm64.tar.gz.sha256 named a file that was not beside it and the
# one careful tester who ran `shasum -c` got FAILED on good bytes. The digest
# was right; the name was the build's, not the publish's.
#
# sha256_publish_as <src.sha256> <dest.sha256> [<published-basename>]
#   Writes dest with the digest from src and the filename field set to the
#   published basename (default: dest's basename minus .sha256), then PROVES
#   it with `shasum -c` in dest's directory, so the file it names must exist
#   there and hash to that digest. Refuses (exit 1, dest removed) otherwise:
#   a checksum file that cannot verify itself is worse than none.
sha256_publish_as() {
  local src="$1" dest="$2" name="${3:-}" digest dir
  [ -n "$name" ] || { name="$(basename "$dest")"; name="${name%.sha256}"; }
  digest="$(awk 'NR==1{print $1}' "$src" 2>/dev/null)"
  case "$digest" in
    *[!0-9a-f]*|"") echo "FAIL: $src does not start with a sha256 digest" >&2; return 1 ;;
  esac
  [ "${#digest}" -eq 64 ] || { echo "FAIL: $src digest is ${#digest} hex chars, not 64" >&2; return 1; }
  printf '%s  %s\n' "$digest" "$name" > "$dest"
  dir="$(dirname "$dest")"
  if ! (cd "$dir" && shasum -a 256 --status -c "$(basename "$dest")"); then
    echo "FAIL: $(basename "$dest") names $name, which is not beside it in $dir or does not hash to $digest" >&2
    rm -f "$dest"; return 1
  fi
}
