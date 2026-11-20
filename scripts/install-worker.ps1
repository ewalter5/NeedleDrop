$ErrorActionPreference = 'Stop'
$workerRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workerRunner = Join-Path $workerRoot 'scripts\run-worker.ps1'
$workerTaskName = 'NeedleDrop local worker'
if (Get-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue) {
    throw 'The NeedleDrop worker task already exists. Inspect or remove it before reinstalling.'
}
if (!(Test-Path -LiteralPath (Join-Path $workerRoot '.env.local'))) {
    throw 'Configure .env.local in the project folder before installing the worker.'
}
$workerPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$workerIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$workerAction = New-ScheduledTaskAction -Execute $workerPowerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$workerRunner`"" -WorkingDirectory $workerRoot
$workerTriggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $workerIdentity),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$workerSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$workerPrincipal = New-ScheduledTaskPrincipal -UserId $workerIdentity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $workerTaskName -Action $workerAction -Trigger $workerTriggers -Settings $workerSettings -Principal $workerPrincipal -Description 'Processes queued NeedleDrop audio and maintenance every five minutes while this user is signed in and online.' | Out-Null
Write-Output 'Installed NeedleDrop local worker. Runs at sign-in and every five minutes while signed in and online.'
Write-Output "Log file: $(Join-Path $workerRoot 'logs\worker.log')"
