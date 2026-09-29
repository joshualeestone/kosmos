#!/bin/bash
# The Windows Plus connector as the Windows build takes it in (kosmos#4597).
#
# tools/build-kosmos-windows.sh stages kosmos-relay's kosmos-tunnel.exe at
# app/bin/kosmos-tunnel.exe, where engine/remote.js looks for it on Windows.
# connector-provenance.sh already ties the bytes to a kosmos-relay commit; these
# say what KIND of file it is, and whether it carries a signature:
#
#   connector_pe_x64 <file>         a PE32+ x86-64 executable, or why not
#   connector_pe_signed <file>      its certificate table is not empty, or why not
#   connector_authenticode <file>   Windows ONLY: Windows itself reports the
#                                   signature Valid, by the expected signer
#
# 🔑 WHY THE BUILD SIGNS NOTHING. The launcher (tools/windows/Kosmos.exe) is signed
# on the Windows PC and then taken as a finished input, never re-signed during a
# cut (tools/windows/README.md). The connector follows the same rule: kosmos-relay's
# tools/build-tunnel-release-windows.ps1 -Sign signs it and writes the .sha256 over
# the SIGNED bytes, so provenance, signature and the staged file all name one set of
# bytes. An unsigned connector is refused here rather than signed here.
#
# ⚠️ connector_pe_signed is a PRESENCE check and runs on any host (a Mac can read a
# PE header). It cannot tell a valid signature from a broken one; only Windows can,
# which is what connector_authenticode is for, and the build runs it on Windows.
# Each function prints why on stderr and returns 1 on refusal.

# Little-endian reads (every host this runs on is little-endian: x86-64, arm64).
_cw_u16() { od -An -tu2 -j "$2" -N2 "$1" 2>/dev/null | tr -d ' \n'; }
_cw_u32() { od -An -tu4 -j "$2" -N4 "$1" 2>/dev/null | tr -d ' \n'; }

# Sets _CW_PE to the PE header offset on success.
connector_pe_x64() {
  local f="${1:?connector_pe_x64 needs a file}" mz pe sig machine magic
  _CW_PE=''
  [ -f "$f" ] || { echo "connector_pe_x64: no file at $f" >&2; return 1; }
  mz="$(_cw_u16 "$f" 0)"
  [ "$mz" = 23117 ] || { echo "connector_pe_x64: $f is not a Windows program (no MZ header); the Windows build needs kosmos-relay's kosmos-tunnel.exe, not the Mac connector" >&2; return 1; }
  pe="$(_cw_u32 "$f" 60)"
  case "$pe" in ''|*[!0-9]*) echo "connector_pe_x64: $f has no readable PE offset" >&2; return 1 ;; esac
  sig="$(_cw_u32 "$f" "$pe")"
  [ "$sig" = 17744 ] || { echo "connector_pe_x64: $f has no PE signature at $pe" >&2; return 1; }
  machine="$(_cw_u16 "$f" $((pe + 4)))"
  [ "$machine" = 34404 ] || { echo "connector_pe_x64: $f is not an x86-64 program (machine $machine)" >&2; return 1; }
  magic="$(_cw_u16 "$f" $((pe + 24)))"
  [ "$magic" = 523 ] || { echo "connector_pe_x64: $f is not PE32+ (optional header magic $magic)" >&2; return 1; }
  _CW_PE="$pe"
  return 0
}

connector_pe_signed() {
  local f="${1:?connector_pe_signed needs a file}" addr size
  connector_pe_x64 "$f" || return 1
  # PE32+: the data directories start 112 bytes into the optional header (itself 24
  # bytes after the PE signature); the certificate table is directory 4.
  addr="$(_cw_u32 "$f" $((_CW_PE + 24 + 112 + 32)))"
  size="$(_cw_u32 "$f" $((_CW_PE + 24 + 112 + 32 + 4)))"
  if [ "${addr:-0}" = 0 ] || [ "${size:-0}" = 0 ]; then
    echo "connector_pe_signed: $f carries no signature. Build it with kosmos-relay tools/build-tunnel-release-windows.ps1 -Sign <the signing script> on the Windows release PC, which signs it before writing its sidecars; a Kosmos build never ships an unsigned connector." >&2
    return 1
  fi
  return 0
}

# Windows only (Git Bash): Get-AuthenticodeSignature must say Valid, and the signer
# must be KOSMOS_WIN_SIGNER (default: Kosmos Agent Manager, Inc.).
connector_authenticode() {
  local f="${1:?connector_authenticode needs a file}" win out status subject want
  want="${KOSMOS_WIN_SIGNER:-Kosmos Agent Manager, Inc.}"
  command -v powershell >/dev/null 2>&1 || command -v powershell.exe >/dev/null 2>&1 || { echo "connector_authenticode: no powershell here to ask Windows about the signature" >&2; return 1; }
  win="$(cygpath -w "$f" 2>/dev/null || printf '%s' "$f")"
  out="$(KOSMOS_CW_FILE="$win" powershell.exe -NoProfile -NonInteractive -Command '$s = Get-AuthenticodeSignature -LiteralPath $env:KOSMOS_CW_FILE; "$($s.Status)|$($s.SignerCertificate.Subject)"' 2>/dev/null | tr -d '\r')"
  status="${out%%|*}"; subject="${out#*|}"
  [ "$status" = Valid ] || { echo "connector_authenticode: Windows reports the connector's signature as '${status:-unknown}', not Valid ($f)" >&2; return 1; }
  case "$subject" in
    *"CN=\"$want\""*|*"CN=$want,"*|*"CN=$want") ;;
    *) echo "connector_authenticode: the connector is signed by '$subject', not $want" >&2; return 1 ;;
  esac
  CONNECTOR_SIGNER="$subject"
  return 0
}
