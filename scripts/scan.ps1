$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $taskRoot 'addon\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Join-Path $taskRoot ('dist\zotero-tray-' + $manifest.version + '.xpi')
if (-not (Test-Path -LiteralPath $package)) { throw 'Build the XPI first' }
$scanner = Get-ChildItem -LiteralPath 'C:\ProgramData\Microsoft\Windows Defender\Platform' -Directory |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'MpCmdRun.exe' } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
if (-not $scanner) { $scanner = 'C:\Program Files\Windows Defender\MpCmdRun.exe' }
$status = Get-MpComputerStatus
if (-not $status.AntivirusEnabled -or -not $status.AMServiceEnabled) { throw 'Defender is not enabled' }
$results = @()
foreach ($target in @((Join-Path $taskRoot 'addon'), $package)) {
    $scanOutput = & $scanner -Scan -ScanType 3 -File $target 2>&1
    $scanExit = $LASTEXITCODE
    $results += [ordered]@{ Target = $target; ExitCode = $scanExit; Output = ($scanOutput -join "`n") }
}
$report = [ordered]@{
    Time = [DateTimeOffset]::Now.ToString('o')
    EngineVersion = $status.AMEngineVersion
    SignatureVersion = $status.AntivirusSignatureVersion
    AntivirusEnabled = $status.AntivirusEnabled
    SHA256 = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
    Scans = $results
}
$artifactDir = Join-Path $taskRoot 'artifacts'
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $artifactDir 'defender-scan.json') -Encoding UTF8
$report | ConvertTo-Json -Depth 5
if ($results | Where-Object { $_.ExitCode -ne 0 }) { throw 'Defender scan did not complete successfully; inspect the report' }
