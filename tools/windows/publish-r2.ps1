<#
publish-r2.ps1 -- publish a Windows build to the R2 bucket the site serves it from, from the
Windows PC, with no Mac step (#3725).

WHY THIS EXISTS. installkosmos.com answers every Windows download name (/dist/kosmos-*-win-x64.zip,
their .sha256 sidecars, latest-win.json and latest-win-staging.json) with a 307 to the public R2
bucket kosmos-dist-win. publish-kosmos-windows.sh and promote-channel.sh --family win only write a
site checkout's dist/, and nothing in the repo uploaded to R2, so every Windows release reached users
by a hand upload. Josh ruled (2026-09-25) that Homer releases Windows independently; this is the
upload step, with the same file set and the same gates as those two scripts.

TWO MODES.

  Staging (the default). From a built zip (tools/build-kosmos-windows.sh):
    kosmos-<v>-win-<arch>.zip, its .sha256 sidecar, then latest-win-staging.json LAST (the pointer
    is the go-live, so it never names bytes that are not already up). Prod readers are untouched.

    pwsh tools/windows/publish-r2.ps1 -Zip .\dist\kosmos-win-x64.zip

  Promote (prod, ONLY on Josh's go). Moves prod onto the staged build, the R2 twin of
  promote-channel.sh --family win: the alias kosmos-win-<arch>.zip becomes a server-side copy of the
  staged versioned zip, its sidecar is rewritten to name the alias, then latest-win.json becomes
  the staging pointer's bytes verbatim, LAST. It refuses unless ALL of these hold:
    - the served staging pointer names exactly -ApprovedVersion and -ApprovedSha,
    - -ApprovalRef is a Slack ts or permalink of Josh's message, and is logged before any write,
    - this PC holds a passing verification record for that sha (tools/win-staging-verify.js writes
      it; tools/lib/win-staging-record.js validates it, through node).

    pwsh tools/windows/publish-r2.ps1 -Promote -ApprovedVersion 0.6.94 -ApprovedSha <sha> -ApprovalRef <ref>

  -DryRun on either mode does every read and check and prints what it would write, writing nothing.

CREDENTIALS. An R2 S3 key scoped to the one bucket (Object Read & Write on kosmos-dist-win only),
from -CredentialFile (default %LOCALAPPDATA%\Kosmos\release-secrets\r2-dist-win.env, lines
R2_ACCOUNT_ID=, R2_ACCESS_KEY_ID=, R2_SECRET_ACCESS_KEY=) or, when that file is absent, from
environment variables of the same names. The secret is never printed.

VERIFICATION. After writing, every name is read back through installkosmos.com (following its 307),
and the bytes must match: the zip by sha256, the sidecar and pointer byte for byte. A publish that
cannot see its own bytes served exits non-zero.

Exit codes: 0 done (or dry run clean), 1 refused or failed. PowerShell 5.1 and 7 both work.
#>
[CmdletBinding(DefaultParameterSetName = 'Staging')]
param(
  [Parameter(ParameterSetName = 'Staging', Mandatory = $true)] [string] $Zip,
  [Parameter(ParameterSetName = 'Staging')] [string] $Version,
  [Parameter(ParameterSetName = 'Staging')] [switch] $ReplaceVersioned,
  [Parameter(ParameterSetName = 'Staging')] [switch] $SkipSignatureCheck,

  [Parameter(ParameterSetName = 'Promote', Mandatory = $true)] [switch] $Promote,
  [Parameter(ParameterSetName = 'Promote', Mandatory = $true)] [string] $ApprovedVersion,
  [Parameter(ParameterSetName = 'Promote', Mandatory = $true)] [string] $ApprovedSha,
  [Parameter(ParameterSetName = 'Promote', Mandatory = $true)] [string] $ApprovalRef,

  [string] $Arch = 'x64',
  [string] $Bucket = 'kosmos-dist-win',
  [string] $CredentialFile = $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Kosmos\release-secrets\r2-dist-win.env' } else { '' }),
  # Where users are served from. Verification reads through this, so it sees what users see.
  [string] $ServedBase = 'https://installkosmos.com/dist',
  # For tests only: write every key under this prefix (e.g. "_selftest/abc/"), and verify through
  # -ServedBase, which a test points at the bucket's public URL plus the same prefix.
  [string] $KeyPrefix = '',
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Say([string] $m) { [Console]::Out.WriteLine("publish-r2: $m") }
function Refuse([string] $m) { [Console]::Error.WriteLine("publish-r2: REFUSING - $m"); exit 1 }

# ---------- names -------------------------------------------------------------------------------
# Every name below is interpolated into an object key, so the tokens get the same guard as
# publish-kosmos-windows.sh: letters, digits and . + _ - only.
function Assert-Token([string] $what, [string] $v) {
  if ($v -notmatch '^[0-9A-Za-z.+_-]+$' -or $v.StartsWith('-')) { Refuse "an implausible $what '$v' (only letters, digits and . + _ -, not starting with -)" }
}
Assert-Token 'arch' $Arch
if ($KeyPrefix -and ($KeyPrefix -notmatch '^[0-9A-Za-z._-]+(/[0-9A-Za-z._-]+)*/$' -or ($KeyPrefix.TrimEnd('/') -split '/') -contains '..' -or ($KeyPrefix.TrimEnd('/') -split '/') -contains '.')) { Refuse "-KeyPrefix '$KeyPrefix' must be path segments ending in '/', with no . or .. segment" }
$Alias = "kosmos-win-$Arch.zip"

# ---------- hashing -----------------------------------------------------------------------------
function Hex([byte[]] $b) { -join ($b | ForEach-Object { $_.ToString('x2') }) }
function Sha256-Bytes([byte[]] $b) { $h = [Security.Cryptography.SHA256]::Create(); try { Hex $h.ComputeHash($b) } finally { $h.Dispose() } }
function Sha256-File([string] $p) {
  $h = [Security.Cryptography.SHA256]::Create(); $s = [IO.File]::OpenRead($p)
  try { Hex $h.ComputeHash($s) } finally { $s.Dispose(); $h.Dispose() }
}
function Hmac([byte[]] $key, [string] $msg) {
  $h = New-Object Security.Cryptography.HMACSHA256 (, $key)
  try { $h.ComputeHash([Text.Encoding]::UTF8.GetBytes($msg)) } finally { $h.Dispose() }
}
$Utf8 = New-Object Text.UTF8Encoding $false

# ---------- credentials -------------------------------------------------------------------------
function Read-Credentials {
  $c = @{}
  if ($CredentialFile -and (Test-Path -LiteralPath $CredentialFile)) {
    foreach ($line in [IO.File]::ReadAllLines($CredentialFile)) {
      if ($line -match '^\s*(?:export\s+)?(R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)\s*=\s*"?([^"\s]+)"?\s*$') { $c[$Matches[1]] = $Matches[2] }
    }
    $from = $CredentialFile
  } else {
    foreach ($n in 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY') { $v = [Environment]::GetEnvironmentVariable($n); if ($v) { $c[$n] = $v } }
    $from = 'the environment'
  }
  foreach ($n in 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY') {
    if (-not $c.ContainsKey($n)) { Refuse "no $n in $from (see the CREDENTIALS note at the top of this script)" }
  }
  if ($c.R2_ACCOUNT_ID -notmatch '^[0-9a-f]{32}$') { Refuse "R2_ACCOUNT_ID from $from is not a 32-hex Cloudflare account id" }
  Say "credentials from $from (key id ending ...$($c.R2_ACCESS_KEY_ID.Substring([Math]::Max(0, $c.R2_ACCESS_KEY_ID.Length - 4))))"
  $c
}

# ---------- R2 over the S3 API, signed with SigV4 ----------------------------------------------
$Http = New-Object Net.Http.HttpClient
$Http.Timeout = [TimeSpan]::FromMinutes(30)

function Invoke-R2 {
  param([string] $Method, [string] $Key, [byte[]] $Body = $null, [string] $BodyFile = $null,
        [string] $PayloadSha = $null, [string] $ContentType = $null, [hashtable] $AmzHeaders = @{})
  $hostName = "$($Cred.R2_ACCOUNT_ID).r2.cloudflarestorage.com"
  $uriPath = "/$Bucket/$Key"   # keys are token-guarded, so no URI encoding is needed
  if (-not $PayloadSha) { $PayloadSha = if ($Body) { Sha256-Bytes $Body } else { Sha256-Bytes ([byte[]]@()) } }
  $now = [DateTime]::UtcNow
  $amzDate = $now.ToString('yyyyMMddTHHmmssZ'); $day = $now.ToString('yyyyMMdd')
  $hdr = [ordered]@{ 'host' = $hostName; 'x-amz-content-sha256' = $PayloadSha; 'x-amz-date' = $amzDate }
  foreach ($k in ($AmzHeaders.Keys | Sort-Object)) { $hdr[$k.ToLowerInvariant()] = $AmzHeaders[$k] }
  $names = @($hdr.Keys | Sort-Object)
  $canonHeaders = -join ($names | ForEach-Object { "$($_):$($hdr[$_])`n" })
  $signed = $names -join ';'
  $canonical = "$Method`n$uriPath`n`n$canonHeaders`n$signed`n$PayloadSha"
  $scope = "$day/auto/s3/aws4_request"
  $toSign = "AWS4-HMAC-SHA256`n$amzDate`n$scope`n$(Sha256-Bytes $Utf8.GetBytes($canonical))"
  $k = Hmac ($Utf8.GetBytes('AWS4' + $Cred.R2_SECRET_ACCESS_KEY)) $day
  $k = Hmac $k 'auto'; $k = Hmac $k 's3'; $k = Hmac $k 'aws4_request'
  $sig = Hex (Hmac $k $toSign)
  $req = New-Object Net.Http.HttpRequestMessage ([Net.Http.HttpMethod]::new($Method)), "https://$hostName$uriPath"
  foreach ($n in $names) { if ($n -ne 'host') { [void]$req.Headers.TryAddWithoutValidation($n, $hdr[$n]) } }
  [void]$req.Headers.TryAddWithoutValidation('Authorization', "AWS4-HMAC-SHA256 Credential=$($Cred.R2_ACCESS_KEY_ID)/$scope, SignedHeaders=$signed, Signature=$sig")
  $stream = $null
  if ($BodyFile) { $stream = [IO.File]::OpenRead($BodyFile); $req.Content = New-Object Net.Http.StreamContent $stream }
  elseif ($Body) { $req.Content = New-Object Net.Http.ByteArrayContent (, $Body) }
  elseif ($Method -eq 'PUT') { $req.Content = New-Object Net.Http.ByteArrayContent (, [byte[]]@()) }
  if ($req.Content -and $ContentType) { $req.Content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::Parse($ContentType) }
  try {
    $resp = $Http.SendAsync($req).GetAwaiter().GetResult()
    $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    [pscustomobject]@{ Status = [int]$resp.StatusCode; Body = $text }
  } catch {
    Refuse "network error on $Method $Key ($($_.Exception.GetBaseException().Message)). Writes before this one may have landed: re-run with -DryRun to see what is served before re-running for real."
  } finally { if ($stream) { $stream.Dispose() }; $req.Dispose() }
}

function Put-Object([string] $Name, [byte[]] $Body, [string] $File, [string] $Sha, [string] $Type) {
  $key = "$KeyPrefix$Name"
  if ($DryRun) { Say "DRY RUN: would PUT $key ($Type, sha256 $Sha)"; return }
  $r = Invoke-R2 -Method PUT -Key $key -Body $Body -BodyFile $File -PayloadSha $Sha -ContentType $Type
  if ($r.Status -ne 200) { Refuse "PUT $key answered $($r.Status): $($r.Body)" }
  Say "wrote $key"
}
function Copy-Object([string] $FromName, [string] $ToName) {
  $from = "$KeyPrefix$FromName"; $to = "$KeyPrefix$ToName"
  if ($DryRun) { Say "DRY RUN: would COPY $from -> $to (server side)"; return }
  $r = Invoke-R2 -Method PUT -Key $to -AmzHeaders @{ 'x-amz-copy-source' = "/$Bucket/$from" }
  if ($r.Status -ne 200 -or $r.Body -match '<Error>') { Refuse "COPY $from -> $to answered $($r.Status): $($r.Body)" }
  Say "copied $from -> $to"
}

# ---------- reading what users are served -------------------------------------------------------
function Get-Served([string] $Name) {
  $url = "$($ServedBase.TrimEnd('/'))/$Name"
  $req = New-Object Net.Http.HttpRequestMessage ([Net.Http.HttpMethod]::Get), $url
  $req.Headers.CacheControl = New-Object Net.Http.Headers.CacheControlHeaderValue
  $req.Headers.CacheControl.NoCache = $true
  try {
    $resp = $Http.SendAsync($req).GetAwaiter().GetResult()
    $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    [pscustomobject]@{ Status = [int]$resp.StatusCode; Bytes = $bytes; Url = $url }
  } catch {
    Refuse "network error reading $url ($($_.Exception.GetBaseException().Message))"
  } finally { $req.Dispose() }
}
function Assert-Served([string] $Name, [string] $WantSha) {
  # The edge can lag a write by a moment; retry briefly before calling it a failure.
  for ($i = 1; $i -le 6; $i++) {
    $s = Get-Served $Name
    $got = if ($s.Status -eq 200) { Sha256-Bytes $s.Bytes } else { '' }
    if ($got -eq $WantSha) { Say "served OK: $($s.Url) ($WantSha)"; return }
    Start-Sleep -Seconds 5
  }
  Refuse "$($s.Url) serves status $($s.Status) sha256 '$got', not the $WantSha just written"
}
function Read-ServedPointer([string] $Name) {
  $s = Get-Served $Name
  if ($s.Status -ne 200) { return $null }
  try { $j = $Utf8.GetString($s.Bytes) | ConvertFrom-Json } catch { Refuse "$($s.Url) is not JSON" }
  # Every field is checked before anything reads it: StrictMode turns a missing property into a
  # crash, and a hand-staged pointer with the wrong shape has happened (0.6.94, 2026-09-25).
  foreach ($f in 'version', 'sha256', 'artifact', 'versioned', 'arch') {
    if (-not ($j.PSObject.Properties.Name -contains $f) -or -not ($j.$f -is [string]) -or -not $j.$f) { Refuse "$($s.Url) is not a usable pointer: '$f' is missing or empty" }
  }
  [pscustomobject]@{ Bytes = $s.Bytes; Json = $j }
}

# The one pointer shape, byte for byte what tools/lib/write-latest-win-pointer.js writes, so a
# promote can copy the staging pointer onto prod verbatim and deploy-site's checks still hold.
function New-PointerBytes([string] $V, [string] $Sha, [string] $Versioned) {
  $Utf8.GetBytes('{"version":"' + $V + '","sha256":"' + $Sha + '","artifact":"' + $Alias + '","versioned":"' + $Versioned + '","arch":"' + $Arch + '"}' + "`n")
}
# A sidecar in shasum's format: "<sha>  <name>\n", naming its own file so `shasum -c` verifies it.
function New-SidecarBytes([string] $Sha, [string] $Name) { $Utf8.GetBytes("$Sha  $Name`n") }

# ---------- the approval log, shared with promote-channel.sh ------------------------------------
$ApprovalLog = if ($env:KOSMOS_WIN_PROMOTE_LOG) { $env:KOSMOS_WIN_PROMOTE_LOG } else { Join-Path $HOME '.claude/logs/win-promote-approvals.log' }
function Write-ApprovalLine([string] $line) {
  if ($DryRun) { Say "DRY RUN: would log to ${ApprovalLog}: $line"; return }
  try {
    [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ApprovalLog))
    [IO.File]::AppendAllText($ApprovalLog, "$line`n", $Utf8)
  } catch { Refuse "could not record Josh's go in $ApprovalLog (an approval that is not logged is not given). Nothing was written." }
}
function Stamp { [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ') }

$Cred = Read-Credentials

if ($PSCmdlet.ParameterSetName -eq 'Staging') {
  # ======================================== STAGING ==========================================
  if (-not (Test-Path -LiteralPath $Zip -PathType Leaf)) { Refuse "no such zip: $Zip" }
  $ZipPath = (Resolve-Path -LiteralPath $Zip).Path
  $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    if (-not $Version) {
      # The version the build baked in (app/package.json inside the zip), never the repo's.
      $e = $archive.GetEntry('app/package.json')
      if (-not $e) { Refuse "$ZipPath has no app/package.json to read the version from (pass -Version)" }
      $r = New-Object IO.StreamReader ($e.Open()); try { $Version = ($r.ReadToEnd() | ConvertFrom-Json).version } finally { $r.Dispose() }
    }
    # The launcher is committed signed (#3677); a zip carrying an unsigned or altered one must not ship.
    $exe = $archive.Entries | Where-Object { $_.FullName -match '(^|/)Kosmos\.exe$' } | Select-Object -First 1
    if (-not $exe) { Refuse "$ZipPath carries no Kosmos.exe" }
    if ($SkipSignatureCheck) { Say "NOTE -SkipSignatureCheck: the launcher's Authenticode signature was NOT checked" }
    elseif (-not (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue)) { Refuse "Get-AuthenticodeSignature is unavailable here, so the launcher's signature cannot be checked (run on Windows, or pass -SkipSignatureCheck deliberately)" }
    else {
      $tmp = Join-Path ([IO.Path]::GetTempPath()) ("kosmos-exe-" + [Guid]::NewGuid().ToString('N') + '.exe')
      [IO.Compression.ZipFileExtensions]::ExtractToFile($exe, $tmp)
      try { $sigStatus = (Get-AuthenticodeSignature -LiteralPath $tmp).Status.ToString() } finally { Remove-Item -LiteralPath $tmp -Force }
      if ($sigStatus -ne 'Valid') { Refuse "the Kosmos.exe inside $ZipPath has Authenticode status '$sigStatus', not Valid" }
      Say "launcher signature: Valid"
    }
  } finally { $archive.Dispose() }
  if (-not $Version) { Refuse "could not read a version from $ZipPath" }
  Assert-Token 'version' $Version
  $Versioned = "kosmos-$Version-win-$Arch.zip"
  $Sha = Sha256-File $ZipPath
  Say "staging $Versioned ($Sha) from $ZipPath"

  # The versioned name is IMMUTABLE once published (the same promise publish-kosmos-windows.sh
  # keeps): republishing different bytes under it hands two builds one name, which is how
  # 0.6.94 staging was served with bytes nobody had announced (2026-09-25).
  $prod = Read-ServedPointer 'latest-win.json'
  # Keyed on the ZIP, not its sidecar: a run interrupted between the two PUTs leaves a served zip
  # with no sidecar, and a sidecar-keyed check would then overwrite it unrefused.
  $existing = Get-Served $Versioned
  if ($existing.Status -eq 200) {
    $existingSha = Sha256-Bytes $existing.Bytes
    if ($existingSha -eq $Sha) { Say "$Versioned is already published with these bytes; re-writing is a no-op for users" }
    elseif ($prod -and $prod.Json.versioned -eq $Versioned) { Refuse "$Versioned is what PROD's latest-win.json names ($existingSha); replacing it would change prod's bytes. Bump the version." }
    elseif (-not $ReplaceVersioned) { Refuse "$Versioned is already published with DIFFERENT bytes ($existingSha). Versioned names are immutable: bump the version, or pass -ReplaceVersioned if the published one was never announced." }
    else { Say "NOTICE -ReplaceVersioned: $Versioned changes from $existingSha to $Sha" }
  }

  # Zip, then sidecar, then pointer LAST, so the pointer never names bytes that are not up.
  Put-Object $Versioned $null $ZipPath $Sha 'application/zip'
  $side = New-SidecarBytes $Sha $Versioned
  Put-Object "$Versioned.sha256" $side $null (Sha256-Bytes $side) 'text/plain; charset=utf-8'
  $ptr = New-PointerBytes $Version $Sha $Versioned
  Put-Object 'latest-win-staging.json' $ptr $null (Sha256-Bytes $ptr) 'application/json'

  if ($DryRun) { Say "DRY RUN complete: nothing was written."; exit 0 }
  Assert-Served $Versioned $Sha
  Assert-Served "$Versioned.sha256" (Sha256-Bytes $side)
  Assert-Served 'latest-win-staging.json' (Sha256-Bytes $ptr)
  Say "STAGED $Version ($Sha). Prod is untouched. Next: verify it on this PC with node tools/win-staging-verify.js (it writes the verification record), then, ONLY on Josh's go for this exact sha:"
  Say "  pwsh tools/windows/publish-r2.ps1 -Promote -ApprovedVersion $Version -ApprovedSha $Sha -ApprovalRef <his message's Slack ts or permalink>"
  exit 0
}

# ========================================== PROMOTE ============================================
Assert-Token 'approved version' $ApprovedVersion
if ($ApprovedSha -notmatch '^[0-9a-f]{64}$') { Refuse "-ApprovedSha must be a lowercase 64-hex sha256" }
if ($ApprovalRef -notmatch '^[A-Za-z0-9._:/?=&%#+-]+$') { Refuse "-ApprovalRef '$ApprovalRef' is not a Slack message ts or permalink. Nothing was written." }

$staging = Read-ServedPointer 'latest-win-staging.json'
if (-not $staging) { Refuse "cannot read the served latest-win-staging.json. Nothing was written." }
$sp = $staging.Json
if ($sp.version -ne $ApprovedVersion -or $sp.sha256 -ne $ApprovedSha) {
  Refuse "the served staging pointer is $($sp.version) ($($sp.sha256)), not the approved $ApprovedVersion ($ApprovedSha). Josh's go covers one exact build. Nothing was written."
}
$Versioned = "kosmos-$ApprovedVersion-win-$Arch.zip"
if ($sp.versioned -ne $Versioned -or $sp.artifact -ne $Alias -or $sp.arch -ne $Arch) {
  Refuse "the staging pointer names versioned '$($sp.versioned)' artifact '$($sp.artifact)' arch '$($sp.arch)', expected '$Versioned' '$Alias' '$Arch' (the promoted latest-win.json would name a download that does not hold these bytes). Re-stage with this script. Nothing was written."
}
# The staged bytes themselves, not just the pointer's claim about them.
Assert-Served $Versioned $ApprovedSha

# The verification record for this sha on this PC, validated by the one spec the writer uses.
$repoTools = Split-Path -Parent $PSScriptRoot
$spec = Join-Path $repoTools 'lib/win-staging-record.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Refuse "node is required to validate the verification record. Nothing was written." }
if (-not (Test-Path -LiteralPath $spec)) { Refuse "the record spec $spec is missing. Nothing was written." }
$verdictJs = @'
const [specFile, wantVersion, wantSha] = process.argv.slice(1);
const spec = require(specFile); const fs = require('node:fs');
const file = spec.recordPath(process.env, wantSha);
let bytes; try { bytes = fs.readFileSync(file); } catch { console.log('HOLD no verification record at ' + file); process.exit(2); }
const sha = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
let record; try { record = JSON.parse(bytes.toString('utf8')); } catch (e) { console.log('AMBIGUOUS unreadable record ' + file); process.exit(3); }
const { problems, verdict } = spec.validateRecord(record, { version: wantVersion, sha256: wantSha });
if (problems.length) { console.log('AMBIGUOUS ' + problems.join('; ')); process.exit(3); }
console.log((verdict === 'pass' ? 'PASS ' : 'FAIL ') + sha + ' ' + file); process.exit(verdict === 'pass' ? 0 : 4);
'@
$verdict = & node -e $verdictJs $spec $ApprovedVersion $ApprovedSha
$rc = $LASTEXITCODE
if ($rc -ne 0) { Refuse "the verification record does not pass ($verdict). Verify the staged build on this PC first (node tools/win-staging-verify.js). Nothing was written." }
$recordSha = ($verdict -split ' ')[1]; $recordPath = ($verdict -split ' ', 3)[2]
Say "verification record: $verdict"

# Josh's go is logged BEFORE any write; a go that is not logged is not given.
Write-ApprovalLine "$(Stamp) family=win path=promote-r2 version=$ApprovedVersion sha256=$ApprovedSha approval_ref=$ApprovalRef record_sha256=$recordSha approval=given record=$recordPath"

# Alias bytes, then its sidecar, then latest-win.json LAST (the staging pointer's bytes verbatim).
# Re-check the staged bytes right before the copy: the record check and the log took time, and
# the copy takes whatever sits at the versioned name NOW (promote-channel.sh's one-snapshot rule).
Assert-Served $Versioned $ApprovedSha
Copy-Object $Versioned $Alias
$aliasSide = New-SidecarBytes $ApprovedSha $Alias
Put-Object "$Alias.sha256" $aliasSide $null (Sha256-Bytes $aliasSide) 'text/plain; charset=utf-8'
Put-Object 'latest-win.json' $staging.Bytes $null (Sha256-Bytes $staging.Bytes) 'application/json'

if ($DryRun) { Say "DRY RUN complete: nothing was written."; exit 0 }
Assert-Served $Alias $ApprovedSha
Assert-Served "$Alias.sha256" (Sha256-Bytes $aliasSide)
Assert-Served 'latest-win.json' (Sha256-Bytes $staging.Bytes)
Write-ApprovalLine "$(Stamp) family=win path=promote-r2 version=$ApprovedVersion sha256=$ApprovedSha approval_ref=$ApprovalRef promoted=yes"
Say "PROMOTED $ApprovedVersion ($ApprovedSha) to prod; served bytes verified."
exit 0
