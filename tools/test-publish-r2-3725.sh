#!/usr/bin/env bash
# test-publish-r2-3725.sh - offline checks for tools/windows/publish-r2.ps1 (#3725).
#
# The script's real work (signed S3 reads and writes to R2, reads back through installkosmos.com)
# needs a network and a key, so it was measured by hand against a throwaway key prefix in the real
# bucket (see the PR). What this pins offline, on every run:
#   1. it parses (PowerShell's own parser, zero errors);
#   2. THE SIGNER: New-SigV4Authorization reproduces AWS's published SigV4 example for S3 (GET
#      Object, examplebucket, 20130524), so a signing change cannot pass by luck;
#   3. POINTER PARITY: the bytes New-PointerBytes writes (with the script's own $Arch and $Alias)
#      equal what tools/lib/write-latest-win-pointer.js writes for the same build. Both promotes
#      copy a staging pointer onto prod byte for byte, so a drift in either writer breaks a promote;
#   4. the refusals that need no network.
#
# Needs pwsh. GitHub's macOS runners ship it; locally a missing pwsh SKIPS, but under CI it FAILS,
# because a guard that silently never runs is not a guard.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PS1="$HERE/windows/publish-r2.ps1"
WRITER="$HERE/lib/write-latest-win-pointer.js"
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

PWSH="$(command -v pwsh || true)"
if [ -z "$PWSH" ]; then
  if [ -n "${CI:-}" ]; then echo "FAIL pwsh is not installed on this CI runner, so publish-r2.ps1 is untested"; exit 1; fi
  echo "SKIP test-publish-r2-3725: pwsh is not installed here (CI runs it)"; exit 0
fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# (pwsh -Command appends trailing words to the command text instead of binding $args, so each
# PowerShell step is a small -File script.)
cat > "$TMP/parse.ps1" <<'PSEOF'
$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$null, [ref]$e)
"errors=" + @($e).Count; $e | ForEach-Object { $_.ToString() }
PSEOF
# Loads named functions and top-level assignments OUT of the real script (no copies), so what is
# tested is what ships. Dot-sourced by the steps below.
cat > "$TMP/load.ps1" <<'PSEOF'
function Import-FromScript([string] $path, [string[]] $functions, [string[]] $variables) {
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
  foreach ($v in $variables) {
    $a = $ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ceq ('$' + $v) } | Select-Object -First 1
    if (-not $a) { throw "no top-level assignment to `$$v" }
    Set-Variable -Scope Global -Name $v -Value (& ([scriptblock]::Create($a.Right.Extent.Text)))
  }
  foreach ($f in $functions) {
    $d = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $f }, $true) | Select-Object -First 1
    if (-not $d) { throw "no function $f" }
    . ([scriptblock]::Create($d.Extent.Text.Replace("function $f", "function global:$f")))
  }
}
PSEOF

# 1. parse
out="$("$PWSH" -NoProfile -File "$TMP/parse.ps1" "$PS1" 2>&1)"
if [ "$(printf '%s\n' "$out" | head -1)" = "errors=0" ]; then pass "parses"; else fail "parse: $out"; fi

# 2. the signer against AWS's published example (Signature Version 4, "Example: GET Object")
cat > "$TMP/sigv4.ps1" <<'PSEOF'
. $args[1]
Import-FromScript $args[0] @('Hex', 'Sha256-Bytes', 'Hmac', 'New-SigV4Authorization') @('Utf8')
$empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
New-SigV4Authorization 'GET' 'examplebucket.s3.amazonaws.com' '/test.txt' @{ 'range' = 'bytes=0-9'; 'x-amz-content-sha256' = $empty; 'x-amz-date' = '20130524T000000Z' } $empty 'AKIAIOSFODNN7EXAMPLE' 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' '20130524T000000Z' 'us-east-1'
PSEOF
want='AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
got="$("$PWSH" -NoProfile -File "$TMP/sigv4.ps1" "$PS1" "$TMP/load.ps1" 2>&1)"
if [ "$got" = "$want" ]; then pass "SigV4 matches AWS's published GET Object example"; else fail "SigV4: got [$got]"; fi

# 3. pointer parity, both from the same inputs
V=0.6.94; SHA=d476fc6c913ee3254f8406ccad0db09724c313551203682c4ad712f51d20c2db
KM_LWP_VERSION=$V KM_LWP_SHA=$SHA KM_LWP_ARTIFACT="kosmos-win-x64.zip" KM_LWP_VERSIONED="kosmos-$V-win-x64.zip" KM_LWP_ARCH=x64 \
  node "$WRITER" "$TMP/js.json" || fail "the JS writer did not run"
cat > "$TMP/pointer.ps1" <<'PSEOF'
. $args[1]
Import-FromScript $args[0] @('New-PointerBytes') @('Arch', 'Alias', 'Utf8')
[IO.File]::WriteAllBytes($args[2], (New-PointerBytes $args[3] $args[4] "kosmos-$($args[3])-win-$Arch.zip"))
PSEOF
"$PWSH" -NoProfile -File "$TMP/pointer.ps1" "$PS1" "$TMP/load.ps1" "$TMP/ps.json" "$V" "$SHA"
rc=$?
if [ "$rc" -ne 0 ]; then fail "could not run New-PointerBytes out of publish-r2.ps1 (rc $rc)"
elif cmp -s "$TMP/js.json" "$TMP/ps.json"; then pass "pointer bytes equal write-latest-win-pointer.js"
else fail "pointer bytes differ: js=$(cat "$TMP/js.json") ps=$(cat "$TMP/ps.json")"; fi

# 4. offline refusals. Each case asserts its own message, not just the exit code, because a
# refusal about something else (no key, say) also exits 1.
refuses() { # <label> <expected substring> <args...>
  local label="$1" want="$2"; shift 2
  local o rc
  # The test transport is set so a refusal that regressed can never reach the real network.
  mkdir -p "$TMP/refuse-fake"
  o="$(env -u R2_ACCOUNT_ID -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY LOCALAPPDATA="$TMP/none" KOSMOS_PUBLISH_R2_FAKE_DIR="$TMP/refuse-fake" "$PWSH" -NoProfile -File "$PS1" "$@" 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$o" | grep -qF -- "$want"; then pass "$label"; else fail "$label: rc=$rc out=$o"; fi
}
printf 'R2_ACCOUNT_ID=%s\nR2_ACCESS_KEY_ID=AKIDTEST\nR2_SECRET_ACCESS_KEY=secret\n' "$(printf 'a%.0s' $(seq 32))" > "$TMP/cred.env"
refuses "bad key prefix refused" "-KeyPrefix" -Zip "$TMP/x.zip" -KeyPrefix 'no-trailing-slash'
refuses "dot-dot key prefix refused" "no . or .. segment" -Zip "$TMP/x.zip" -KeyPrefix '../'
refuses "a stand-in served base needs a test prefix" "-ServedBase is for tests" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef 1.2 -ServedBase https://example.com/dist
refuses "missing zip refused" "no such zip" -Zip "$TMP/absent.zip"
refuses "no key refused" "no R2_ACCOUNT_ID" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef 1.2
refuses "non-x.y.z version refused" "x.y.z" -Promote -ApprovedVersion '-0.6.94' -ApprovedSha "$SHA" -ApprovalRef 1.2 -CredentialFile "$TMP/cred.env"
refuses "malformed sha refused" "lowercase 64-hex" -Promote -ApprovedVersion 1.2.3 -ApprovedSha nothex -ApprovalRef 1.2 -CredentialFile "$TMP/cred.env"
# PowerShell's plain -match ignores case; these must not.
refuses "UPPERCASE sha refused" "lowercase 64-hex" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$(printf '%s' "$SHA" | tr a-f A-F)" -ApprovalRef 1.2 -CredentialFile "$TMP/cred.env"
refuses "shell-ish approval ref refused" "is not a Slack message ts" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef 'x; rm' -CredentialFile "$TMP/cred.env"
refuses "approval ref with a trailing newline refused" "is not a Slack message ts" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef $'1.2\n' -CredentialFile "$TMP/cred.env"
# A zip whose launcher is not the committed Kosmos.exe (the refusal comes before any network).
python3 - "$TMP/wrongexe.zip" <<'PYEOF'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('app/package.json', '{"version":"9.9.1"}'); z.writestr('Kosmos.exe', 'MZ not the launcher')
PYEOF
refuses "a zip with another launcher refused" "is not the committed launcher" -Zip "$TMP/wrongexe.zip" -CredentialFile "$TMP/cred.env"

# 5. THE GATES AND THE ORDER, through the script's test transport (KOSMOS_PUBLISH_R2_FAKE_DIR: a
# local directory is the bucket; every request is logged to <dir>/.calls). Each refusal must
# leave ZERO writes; the happy paths must write in the order the header promises.
FAKE="$TMP/bucket"; mkdir -p "$FAKE"; VDIR="$TMP/vdir"; mkdir -p "$VDIR"; ALOG="$TMP/approvals.log"
EXE="$HERE/windows/Kosmos.exe"
mkzip() { python3 - "$1" "$2" "$EXE" "$3" <<'PYEOF'
import sys, zipfile
out, ver, exe, tag = sys.argv[1:5]
with zipfile.ZipFile(out, 'w') as z:
    z.writestr('app/package.json', '{"version":"%s"}' % ver); z.writestr('Kosmos.exe', open(exe, 'rb').read()); z.writestr('tag.txt', tag)
PYEOF
}
mkzip "$TMP/a.zip" 9.9.1 A; mkzip "$TMP/b.zip" 9.9.1 B
SHA_A=$(shasum -a 256 "$TMP/a.zip" | cut -d' ' -f1)
fake() { : > "$FAKE/.calls"; KOSMOS_PUBLISH_R2_FAKE_DIR="$FAKE" KOSMOS_WIN_VERIFY_DIR="$VDIR" KOSMOS_WIN_PROMOTE_LOG="$ALOG" "$PWSH" -NoProfile -File "$PS1" -CredentialFile "$TMP/cred.env" "$@" > "$TMP/out" 2>&1; }
writes() { grep -c '^PUT ' "$FAKE/.calls" || true; }
record() { node -e 'const s=require(process.argv[1]);const [v,sha,res,out]=process.argv.slice(2);const c={};for(const r of s.REQUIRED_CHECKS)c[r.id]={result:"pass"};if(res==="fail")c.msg={result:"fail"};require("fs").writeFileSync(out,JSON.stringify(s.buildRecord({version:v,sha256:sha,sourceSha:"a".repeat(40),checkResults:c,at:"2026-09-25T12:00:00Z"})))' "$HERE/lib/win-staging-record.js" 9.9.1 "$SHA_A" "$1" "$VDIR/win-staging-$SHA_A.json"; }
promote() { fake -Promote -ApprovedVersion 9.9.1 -ApprovedSha "$SHA_A" -ApprovalRef 1789228393.821399 "$@"; }
refuses_clean() { # <label> <expected substring>   (after a fake run): refused, said why, wrote nothing
  if [ "$rc" -eq 1 ] && grep -qF -- "$2" "$TMP/out" && [ "$(writes)" -eq 0 ]; then pass "$1"; else fail "$1: rc=$rc writes=$(writes) out=$(tail -2 "$TMP/out")"; fi
}

fake -Zip "$TMP/a.zip" -DryRun; rc=$?
if [ "$rc" -eq 0 ] && [ "$(writes)" -eq 0 ] && [ ! -e "$FAKE/latest-win-staging.json" ]; then pass "a staging -DryRun writes nothing"; else fail "staging dry run: rc=$rc writes=$(writes)"; fi
fake -Zip "$TMP/a.zip"; rc=$?
order=$(grep '^PUT ' "$FAKE/.calls" | awk '{print $2}' | tr '\n' ' ')
if [ "$rc" -eq 0 ] && [ "$order" = "kosmos-9.9.1-win-x64.zip kosmos-9.9.1-win-x64.zip.sha256 latest-win-staging.json " ]; then pass "staging writes zip, sidecar, then the pointer LAST"
else fail "staging order: rc=$rc order=[$order] $(tail -2 "$TMP/out")"; fi
# The headers that make it safe were SENT: a create-only zip, no-cache on what gets overwritten.
if grep -qE '^PUT kosmos-9\.9\.1-win-x64\.zip \| if-none-match=\*$' "$FAKE/.calls" \
   && grep -qE '^PUT kosmos-9\.9\.1-win-x64\.zip\.sha256 \| cache-control=no-cache$' "$FAKE/.calls" \
   && grep -qE '^PUT latest-win-staging\.json \| cache-control=no-cache$' "$FAKE/.calls"; then pass "staging sends If-None-Match on the new zip and no-cache on the sidecar and pointer"
else fail "staging headers: $(cat "$FAKE/.calls")"; fi
# The next step is printed with the sha left for Josh's message to supply.
if grep -qF -- "-ApprovedSha <sha from his go>" "$TMP/out" && ! grep -F -- "-ApprovedSha $SHA_A" "$TMP/out" >/dev/null; then pass "staging does not hand out the sha to paste into the approval"
else fail "staging next-step line: $(grep -F -- '-Promote' "$TMP/out")"; fi
# A same-bytes re-run (the advice after an interrupted run) keeps the versioned zip cacheable.
fake -Zip "$TMP/a.zip"; rc=$?
if [ "$rc" -eq 0 ] && grep -qE '^PUT kosmos-9\.9\.1-win-x64\.zip \| $' "$FAKE/.calls"; then pass "a same-bytes re-stage uploads the zip with no no-cache and no create-only header"
else fail "same-bytes re-stage headers: rc=$rc $(grep '^PUT kosmos-9.9.1-win-x64.zip ' "$FAKE/.calls")"; fi
fake -Zip "$TMP/b.zip"; rc=$?; refuses_clean "different bytes under a published version are refused, nothing written" "DIFFERENT bytes"
fake -Zip "$TMP/a.zip" -Version 9.9.2; rc=$?; refuses_clean "a -Version the zip was not built as is refused" "not the version this zip was built as"

promote; rc=$?; refuses_clean "promote with no verification record: refused, nothing written" "HOLD no verification record"
record fail; promote; rc=$?; refuses_clean "promote with a FAILING record: refused, nothing written" "does not pass (FAIL"
record pass
fake -Promote -ApprovedVersion 9.9.1 -ApprovedSha "$(printf 'b%.0s' $(seq 64))" -ApprovalRef 1789228393.821399; rc=$?
refuses_clean "a promote whose sha is not the staged one: refused, nothing written" "check his message"
if ! grep -qF "$SHA_A" "$TMP/out"; then pass "that refusal does not print the staged sha"; else fail "the mismatch refusal printed the staged sha"; fi
promote -DryRun; rc=$?
if [ "$rc" -eq 0 ] && [ "$(writes)" -eq 0 ] && [ ! -e "$ALOG" -o ! -s "$ALOG" ]; then pass "a promote -DryRun writes nothing and logs nothing"; else fail "promote dry run: rc=$rc writes=$(writes) log=$(cat "$ALOG" 2>/dev/null)"; fi
: > "$FAKE/.calls"; KOSMOS_WIN_PROMOTE_LOG_SAVE="$ALOG"; mkdir -p "$TMP/notafile"
KOSMOS_PUBLISH_R2_FAKE_DIR="$FAKE" KOSMOS_WIN_VERIFY_DIR="$VDIR" KOSMOS_WIN_PROMOTE_LOG="$TMP/notafile" "$PWSH" -NoProfile -File "$PS1" -CredentialFile "$TMP/cred.env" -Promote -ApprovedVersion 9.9.1 -ApprovedSha "$SHA_A" -ApprovalRef 1789228393.821399 > "$TMP/out" 2>&1; rc=$?
refuses_clean "a promote whose approval cannot be logged: refused, nothing written" "an approval that is not logged is not given"
cp "$FAKE/latest-win-staging.json" "$TMP/ptr.good"
printf '{"version":"9.9.1","sha256":"%s","artifact":"kosmos-9.9.1-win-x64.zip","versioned":"kosmos-9.9.1-win-x64.zip","arch":"x64"}\n' "$SHA_A" > "$FAKE/latest-win-staging.json"
promote; rc=$?; refuses_clean "promote of a non-canonical staging pointer: refused, nothing written" "canonical pointer shape"
cp "$TMP/ptr.good" "$FAKE/latest-win-staging.json"
cp "$FAKE/kosmos-9.9.1-win-x64.zip.sha256" "$TMP/side.good"; printf '%s  wrong-name.zip\n' "$SHA_A" > "$FAKE/kosmos-9.9.1-win-x64.zip.sha256"
promote; rc=$?; refuses_clean "promote with a wrong versioned sidecar: refused, nothing written" "kosmos-9.9.1-win-x64.zip.sha256 as"
cp "$TMP/side.good" "$FAKE/kosmos-9.9.1-win-x64.zip.sha256"
: > "$ALOG"
promote; rc=$?
order=$(grep '^PUT ' "$FAKE/.calls" | awk '{print $2 ($3 == "COPY" ? "(copy)" : "")}' | tr '\n' ' ')
if [ "$rc" -eq 0 ] && [ "$order" = "kosmos-win-x64.zip(copy) kosmos-win-x64.zip.sha256 latest-win.json " ] \
   && cmp -s "$FAKE/latest-win.json" "$FAKE/latest-win-staging.json" && cmp -s "$FAKE/kosmos-win-x64.zip" "$TMP/a.zip"; then
  pass "promote writes the alias copy, its sidecar, then latest-win.json LAST (the staging bytes verbatim)"
else fail "promote order: rc=$rc order=[$order] $(tail -2 "$TMP/out")"; fi
if [ "$(grep -c 'approval=given.*transport=test' "$ALOG")" -eq 1 ] && [ "$(grep -c 'promoted=yes.*transport=test' "$ALOG")" -eq 1 ]; then pass "both approval-log lines name where the promote wrote"
else fail "approval log: $(cat "$ALOG")"; fi
# The promote's copy carried its pin and its own no-cache metadata.
if grep -qE '^PUT kosmos-win-x64\.zip COPY /kosmos-dist-win/kosmos-9\.9\.1-win-x64\.zip \| cache-control=no-cache;x-amz-copy-source=[^;]+;x-amz-copy-source-if-match="[0-9a-f]{64}";x-amz-metadata-directive=REPLACE$' "$FAKE/.calls"; then pass "the alias copy is pinned and replaces its metadata with no-cache"
else fail "copy headers: $(grep COPY "$FAKE/.calls")"; fi
# -ReplaceVersioned never replaces what prod names.
fake -Zip "$TMP/b.zip" -ReplaceVersioned; rc=$?; refuses_clean "-ReplaceVersioned refuses the version prod names" "what PROD's latest-win.json names"
# A staging failure after its writes began says what may be up.
: > "$FAKE/.calls"; mkzip "$TMP/c.zip" 9.9.2 C
KOSMOS_PUBLISH_R2_FAKE_FAIL=latest-win-staging.json fake -Zip "$TMP/c.zip"; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "staging writes had begun" "$TMP/out"; then pass "a staging failure after its first write says what may be up"
else fail "staging partial-state note: rc=$rc $(tail -2 "$TMP/out")"; fi
# The alias copy is pinned to the zip the promote checked: a re-stage that lands between the
# checks and the copy must stop the promote before prod's pointer moves.
rm -f "$FAKE/kosmos-win-x64.zip" "$FAKE/kosmos-win-x64.zip.sha256" "$FAKE/latest-win.json"
KOSMOS_PUBLISH_R2_FAKE_RESTAGE_BEFORE_COPY="$TMP/b.zip" promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "COPY kosmos-9.9.1-win-x64.zip -> kosmos-win-x64.zip answered 412" "$TMP/out" && [ ! -e "$FAKE/latest-win.json" ] && [ ! -e "$FAKE/kosmos-win-x64.zip" ]; then pass "a re-stage between the checks and the copy stops the promote before prod moves"
else fail "ETag pin: rc=$rc latest-win.json=$([ -e "$FAKE/latest-win.json" ] && echo WRITTEN || echo absent) $(tail -2 "$TMP/out")"; fi
cp "$TMP/a.zip" "$FAKE/kosmos-9.9.1-win-x64.zip"
# The approval line keeps record= LAST, since a Windows record path can hold spaces.
_given=$(grep 'approval=given' "$ALOG" | tail -1)
if [ -n "$_given" ] && printf '%s' "$_given" | grep -qE ' record=[^ ]+$'; then pass "record= is the last field of the approval line"
else fail "approval line field order: $_given"; fi
# A failure after prod-facing writes began says so.
: > "$FAKE/.calls"; KOSMOS_PUBLISH_R2_FAKE_FAIL=latest-win.json promote; rc=$?
if [ "$rc" -eq 1 ] && grep -qF "prod-facing writes had begun" "$TMP/out"; then pass "a failure after the first prod-facing write says what may have changed"
else fail "partial-state note: rc=$rc $(tail -2 "$TMP/out")"; fi

[ "$fails" -eq 0 ] && { echo "test-publish-r2-3725: all passed"; exit 0; }
echo "test-publish-r2-3725: $fails failed"; exit 1
