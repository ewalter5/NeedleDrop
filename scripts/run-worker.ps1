$ErrorActionPreference = 'Stop'
$workerRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workerRoot
$workerLogDirectory = Join-Path $workerRoot 'logs'
$null = New-Item -ItemType Directory -Path $workerLogDirectory -Force
$workerLog = Join-Path $workerLogDirectory 'worker.log'
if ((Test-Path -LiteralPath $workerLog) -and (Get-Item -LiteralPath $workerLog).Length -gt 2MB) {
    Set-Content -LiteralPath $workerLog -Value 'Worker log rotated.' -Encoding utf8
}
try {
    # Scheduled tasks don't inherit an interactive terminal's fnm or new PATH.
    $env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $workerFnm = Get-Command fnm -ErrorAction SilentlyContinue
    if ($workerFnm) {
        & $workerFnm.Source env --shell powershell | Out-String | Invoke-Expression
        & $workerFnm.Source use 24 *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Node 24 is not installed in fnm.' }
    }
    $workerNode = (Get-Command node -ErrorAction Stop).Source
    foreach ($workerTool in @('ffmpeg', 'ffprobe', 'yt-dlp')) {
        $null = Get-Command $workerTool -ErrorAction Stop
    }
    Add-Content -LiteralPath $workerLog -Value "$(Get-Date -Format o) Starting worker cycle." -Encoding utf8
    $workerOutput = & $workerNode 'node_modules/tsx/dist/cli.mjs' 'scripts/jobs.ts' 2>&1
    $workerExit = $LASTEXITCODE
    $workerOutput | Out-File -FilePath $workerLog -Append -Encoding utf8
    Add-Content -LiteralPath $workerLog -Value "$(Get-Date -Format o) Worker exit code: $workerExit" -Encoding utf8
    exit $workerExit
} catch {
    # Do not log environment values, credentials, or raw process errors.
    Add-Content -LiteralPath $workerLog -Value "$(Get-Date -Format o) Worker could not start. Check Node 24, the audio tools, network, and .env.local." -Encoding utf8
    exit 1
}
