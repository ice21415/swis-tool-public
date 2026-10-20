$ErrorActionPreference = 'Stop'
$repository = 'ice21415/swis-tool-public'
$base = Join-Path $env:LOCALAPPDATA 'SWIS-Tool'
$extension = Join-Path $base 'extension'
New-Item -ItemType Directory -Force -Path $base | Out-Null
$lock = $null
try {
    $lock = [IO.File]::Open((Join-Path $base 'update.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $release = Invoke-RestMethod "https://api.github.com/repos/$repository/releases/latest" -Headers @{'User-Agent'='SWIS-Updater'} -TimeoutSec 30
    if ($release.tag_name -notmatch '^v(\d+\.\d+\.\d+(?:\.\d+)?)$') { throw 'Invalid release version.' }
    $version = $Matches[1]
    $installedManifest = Join-Path $extension 'manifest.json'
    if (Test-Path -LiteralPath $installedManifest) {
        $installed = Get-Content -LiteralPath $installedManifest -Raw -Encoding UTF8 | ConvertFrom-Json
        if ([version]$version -le [version]$installed.version) { return }
    }
    $asset = @($release.assets | Where-Object name -eq 'swis-tool.zip')
    $checksum = @($release.assets | Where-Object name -eq 'swis-tool.zip.sha256')
    if ($asset.Count -ne 1 -or $checksum.Count -ne 1) { throw 'Release assets are incomplete.' }
    foreach ($url in @($asset[0].browser_download_url, $checksum[0].browser_download_url)) {
        if (-not $url.StartsWith("https://github.com/$repository/releases/download/", [StringComparison]::Ordinal)) { throw 'Unexpected asset origin.' }
    }
    $stage = Join-Path $base ('stage-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    $zip = Join-Path $stage 'release.zip'
    $sum = Join-Path $stage 'release.sha256'
    Invoke-WebRequest -UseBasicParsing $asset[0].browser_download_url -OutFile $zip -TimeoutSec 120
    Invoke-WebRequest -UseBasicParsing $checksum[0].browser_download_url -OutFile $sum -TimeoutSec 30
    $expected = (Get-Content -LiteralPath $sum -Raw).Trim().Split(' ')[0]
    if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected) { throw 'Archive checksum mismatch.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName -match '(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)') { throw 'Unsafe archive path.' }
        }
    } finally { $archive.Dispose() }
    $payload = Join-Path $stage 'payload'
    Expand-Archive -LiteralPath $zip -DestinationPath $payload
    $manifest = Get-Content -LiteralPath (Join-Path $payload 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $inventory = Get-Content -LiteralPath (Join-Path $payload 'release-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.version -ne $version -or $inventory.version -ne $version -or $manifest.manifest_version -ne 3) { throw 'Release metadata mismatch.' }
    foreach ($property in $inventory.files.PSObject.Properties) {
        if ($property.Name -match '(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)') { throw 'Unsafe file inventory path.' }
        if ((Get-FileHash -LiteralPath (Join-Path $payload $property.Name) -Algorithm SHA256).Hash -ne $property.Value) { throw 'Runtime file checksum mismatch.' }
    }
    $actualFiles = @(Get-ChildItem -LiteralPath $payload -Recurse -File)
    if ($actualFiles.Count -ne @($inventory.files.PSObject.Properties).Count + 1) { throw 'Unexpected files in release.' }
    $backup = Join-Path $base ('backup-' + (Get-Date -Format 'yyyyMMddHHmmss') + '-' + [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $extension) { Move-Item -LiteralPath $extension -Destination $backup }
    try { Move-Item -LiteralPath $payload -Destination $extension }
    catch {
        if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $extension }
        throw
    }
    "Updated to $version. Restart Chrome to activate. Backup: $backup" | Set-Content -LiteralPath (Join-Path $base 'status.txt') -Encoding UTF8
} catch {
    $_.Exception.Message | Set-Content -LiteralPath (Join-Path $base 'last-error.txt') -Encoding UTF8
    throw
} finally { if ($lock) { $lock.Dispose() } }
