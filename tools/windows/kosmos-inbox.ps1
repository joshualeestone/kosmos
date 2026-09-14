# kosmos-inbox.ps1 -- Slack receive + last-mile DELIVERY for Windows agents (#2042).
#
# DEPLOYED COPY: ~/.local/bin/kosmos-inbox.ps1. This copy in the repo exists so the
# change is reviewable in the PR; keep the two in sync. (Approved decision Q3: grow
# THIS script from "print envelopes" into "deliver envelopes"; board integration is
# a later refactor.)
#
# WHY THIS EXISTS: the fleet's push path (slack-relay.mjs -> claude-msg -> tmux
# pane) has no Windows implementation. Reading Slack works fine from Windows (the
# bot token carries channels:history), and a Windows worker agent is reachable on
# this box over its supervisor's named pipe (engine/win32channel.js). This script
# closes the last mile: a Slack envelope addressed to a LIVE local worker is turned
# into a delivery into that agent's session.
#
#   PRINT MODE (legacy, unchanged -- the windows-orchestrator pull; Q1 pending):
#     kosmos-inbox.ps1            # new envelopes to windows-orchestrator since last run
#     kosmos-inbox.ps1 -All       # ignore the cursor, show everything addressed there
#     kosmos-inbox.ps1 -Peek      # show new ones WITHOUT advancing the cursor
#
#   DELIVER MODE (#2042 S1 -- worker agents):
#     kosmos-inbox.ps1 -Deliver         # deliver new envelopes to live local workers
#     kosmos-inbox.ps1 -Deliver -All    # ignore the cursor; deliver everything pending
#     kosmos-inbox.ps1 -Deliver -Peek   # DRY RUN: show what would be delivered, send
#                                       #   nothing, advance nothing
#
# The two modes keep SEPARATE cursor files, so a print run can never consume a
# worker's undelivered envelope, and vice versa.
#
# ALL routing + verdict->cursor logic lives in engine/win32inbox.js (node,
# unit-tested); this script is Slack + cursor I/O only. The delivery verdict rules
# (placed -> advance; unconfirmed -> advance+log; could_not -> cursor UNMOVED so the
# next poll retries it; no spool) are that module's, mirroring chat.js exactly.
#
# Exit 0 = ran. Exit 3 = we could not read the machine's live agents (roster
# unreadable): NOTHING is advanced, so the next run retries the whole batch.
param(
    [switch]$All,
    [switch]$Peek,
    [switch]$Deliver
)

$ErrorActionPreference = 'Stop'

$AGENT      = 'windows-orchestrator'
$SecretPath = "$env:USERPROFILE\.kosmos-secrets\slack.json"

# Delivery mode carries its own cursor so it never fights the legacy print cursor.
$StatePath  = if ($Deliver) { "$env:USERPROFILE\.kosmos-secrets\inbox-deliver-cursor.txt" }
              else           { "$env:USERPROFILE\.kosmos-secrets\inbox-cursor.txt" }

# The Kosmos runtime node and the engine that holds win32inbox.js. Both are
# overridable so the coordinator's rehearsal can point at a worktree's engine.
$Node       = if ($env:KOSMOS_NODE)       { $env:KOSMOS_NODE }       else { "$env:LOCALAPPDATA\Kosmos\runtime\node.exe" }
$EngineDir  = if ($env:KOSMOS_ENGINE_DIR) { $env:KOSMOS_ENGINE_DIR } else { "$env:USERPROFILE\src\kosmos\engine" }
$InboxJs    = Join-Path $EngineDir 'win32inbox.js'

if (-not (Test-Path -LiteralPath $SecretPath)) {
    Write-Error "no credentials at $SecretPath"
    exit 1
}
$cfg = Get-Content -LiteralPath $SecretPath -Raw | ConvertFrom-Json
$H   = @{ Authorization = "Bearer $($cfg.bot_token)" }

$since = '0'
if (-not $All -and (Test-Path -LiteralPath $StatePath)) {
    $since = (Get-Content -LiteralPath $StatePath -Raw).Trim()
    if (-not $since) { $since = '0' }
}

$uri = "https://slack.com/api/conversations.history?channel=$($cfg.channel)&limit=100&oldest=$since"
$resp = Invoke-RestMethod -Uri $uri -Headers $H

if (-not $resp.ok) {
    Write-Error "slack error: $($resp.error)"
    exit 1
}

# Oldest-first so a run reads in the order things were said. (win32inbox also sorts
# by numeric ts, so ordering is pinned on both sides.)
$msgs = @($resp.messages) | Sort-Object { [double]$_.ts }

# ── DELIVER MODE (#2042 S1) ──────────────────────────────────────────────────
if ($Deliver) {
    if (-not (Test-Path -LiteralPath $Node))    { Write-Error "no node runtime at $Node (set KOSMOS_NODE)"; exit 1 }
    if (-not (Test-Path -LiteralPath $InboxJs)) { Write-Error "no win32inbox.js at $InboxJs (set KOSMOS_ENGINE_DIR)"; exit 1 }

    # Hand every message (text + ts) to the node brain; it decides which are for a
    # live local worker, delivers those through win32channel, and returns the ONE
    # cursor to write.
    $payload = @{ messages = @($msgs | ForEach-Object { @{ ts = "$($_.ts)"; text = "$($_.text)" } }) }
    $json = $payload | ConvertTo-Json -Depth 5 -Compress

    # Drive node through .NET Process so stdin/stdout are UTF-8 and message bodies
    # (which can carry non-ASCII) are not mangled the way a PS 5.1 pipe would.
    # NB Windows PowerShell 5.1 is on .NET Framework: it has no ArgumentList and no
    # StandardInputEncoding, so the arguments are one quoted string (fixed module
    # path + literals, no user input) and stdin is written as raw UTF-8 bytes.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = $Node
    $argline = '"' + $InboxJs + '" run'
    if ($Peek) { $argline += ' --peek' }
    $psi.Arguments              = $argline
    $psi.RedirectStandardInput  = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute        = $false
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding  = [System.Text.Encoding]::UTF8

    $proc = [System.Diagnostics.Process]::Start($psi)
    # No-BOM UTF-8: a leading byte-order mark would make node's JSON.parse reject
    # the payload (win32inbox also strips one defensively).
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $bytes = $utf8NoBom.GetBytes($json)
    $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $proc.StandardInput.BaseStream.Flush()
    $proc.StandardInput.Close()
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    $result = $null
    try { $result = ($stdout.Trim() -split "`n" | Select-Object -Last 1) | ConvertFrom-Json } catch { }
    if (-not $result) {
        Write-Error "win32inbox returned nothing usable (exit $($proc.ExitCode)): $stderr"
        exit 1
    }

    if (-not $result.ok) {
        # roster_unreadable: we could not see the machine's live agents, so we
        # cannot tell whether any envelope is for a live worker. Advance NOTHING.
        Write-Output "=== kosmos inbox (deliver): could not read live agents ($($result.reason)); advancing nothing, will retry ==="
        exit 3
    }

    $placed = 0; $unconf = 0; $could = 0; $skipped = 0; $peeked = 0
    foreach ($r in @($result.results)) {
        switch ($r.kind) {
            'placed'        { Write-Output ("-> placed       to $($r.target)  (ts=$($r.ts))"); $placed++ }
            'unconfirmed'   { Write-Output ("-> UNCONFIRMED  to $($r.target)  (ts=$($r.ts)) -- $($r.because)"); $unconf++ }
            'could_not'     { Write-Output ("-> COULD_NOT    to $($r.target)  (ts=$($r.ts)) -- $($r.because); cursor left here, will retry"); $could++ }
            'would_deliver' { Write-Output ("-> would deliver to $($r.target)  (ts=$($r.ts))  [peek]"); $peeked++ }
            default         { $skipped++ }
        }
    }
    Write-Output "=== kosmos inbox (deliver): placed=$placed unconfirmed=$unconf could_not=$could would_deliver=$peeked not_local=$skipped ==="

    # -Peek is a dry run: node returns advanceTo=null, and we persist nothing.
    if (-not $Peek -and $result.advanceTo) {
        Set-Content -LiteralPath $StatePath -Value ([string]$result.advanceTo) -Encoding ascii -NoNewline
        Write-Output "(cursor -> $($result.advanceTo))"
    } elseif (-not $Peek) {
        Write-Output "(cursor unchanged -- nothing advanced this poll)"
    }
    exit 0
}

# ── PRINT MODE (legacy, unchanged) ───────────────────────────────────────────
$mine    = @()
$skipped = 0

foreach ($m in $msgs) {
    if (-not $m.text) { continue }

    # Never treat our own outgoing envelopes as inbound.
    if ($m.text -match '(?m)^from:\s*' + [regex]::Escape($AGENT)) { continue }

    # The `to:` line is what routes. It may list several agents, comma separated.
    $addressed = $false
    foreach ($line in [regex]::Matches($m.text, '(?m)^to:\s*(.+)$')) {
        foreach ($name in ($line.Groups[1].Value -split ',')) {
            $n = $name.Trim() -replace '\s*\(.*$', ''
            if ($n -eq $AGENT) { $addressed = $true }
        }
    }
    if ($addressed) { $mine += $m } else { $skipped++ }
}

Write-Output "=== kosmos inbox: $($mine.Count) addressed to $AGENT, $skipped skipped (not addressed here) ==="
Write-Output ""

foreach ($m in $mine) {
    $when = [DateTimeOffset]::FromUnixTimeSeconds([math]::Floor([double]$m.ts)).LocalDateTime.ToString('yyyy-MM-dd HH:mm')
    Write-Output "-------- $when  (ts=$($m.ts)) --------"
    Write-Output $m.text
    Write-Output ""
}

if ($mine.Count -eq 0) { Write-Output "no new envelopes." }

# Advance the cursor to the newest message SEEN (not just matched), so skipped
# traffic is not re-scanned forever. -Peek deliberately leaves it alone.
if (-not $Peek -and $msgs.Count -gt 0) {
    $newest = ($msgs | Select-Object -Last 1).ts
    Set-Content -LiteralPath $StatePath -Value $newest -Encoding ascii -NoNewline
    Write-Output "(cursor -> $newest)"
}
