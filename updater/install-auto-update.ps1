param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$repository = 'ice21415/swis-tool-public'
$base = Join-Path $env:LOCALAPPDATA 'SWIS-Tool'
$extension = Join-Path $base 'extension'
if ($CheckOnly) {
    Invoke-RestMethod "https://api.github.com/repos/$repository/releases/latest" -Headers @{'User-Agent'='SWIS-Updater'} -TimeoutSec 30 | Select-Object tag_name, html_url
    return
}
New-Item -ItemType Directory -Force -Path $base | Out-Null
$updater = Join-Path $base 'update.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update-installed-extension.ps1') -Destination $updater -Force
& $updater
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $updater + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'SWIS-Tool-GitHub-Update' -Action $action -Trigger $trigger -Settings $settings -Description 'Update SWIS Tool from official public GitHub Releases; no case data is transmitted.' -Force | Out-Null
Write-Output "Installed: $extension"
Write-Output 'Load this folder once using chrome://extensions > Load unpacked. Hourly checks are enabled. Restart Chrome to activate downloaded versions.'
