param(
    [Parameter(Mandatory)][string]$Tag,
    [string]$Repository = 'razaxq/vocal',
    [string]$ArtifactDirectory = 'data/native-release',
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid repository' }
$version = (Get-Content "$repo/package.json" -Raw | ConvertFrom-Json).version
if ($Tag -cne "v$version" -or $Tag -notmatch '^v\d+\.\d+\.\d+$') { throw 'Release tag must match package.json exactly' }
$directory = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$names = @("Vocal-Native-Setup-$version.exe", "Vocal-Native-$version-win-x64.zip", 'SHA256SUMS.txt')
$actual = @(Get-ChildItem -LiteralPath $directory -File | Select-Object -ExpandProperty Name)
if (@(Compare-Object $names $actual).Count) { throw 'Release directory must contain exactly the installer, ZIP and SHA256SUMS.txt' }
$hashes = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $directory 'SHA256SUMS.txt')) {
    if ($line -notmatch '^([a-f0-9]{64})  ([^/\\]+)$') { throw 'Invalid checksum entry' }
    $digest, $name = $Matches[1], $Matches[2]
    if ($hashes.ContainsKey($name) -or $name -notin $names[0..1]) { throw 'Unexpected or duplicate checksum entry' }
    if ((Get-FileHash -LiteralPath (Join-Path $directory $name) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $digest) { throw "Checksum mismatch: $name" }
    $hashes[$name] = $digest
}
if ($hashes.Count -ne 2) { throw 'Missing package checksum' }
$hashes['SHA256SUMS.txt'] = (Get-FileHash -LiteralPath (Join-Path $directory 'SHA256SUMS.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $directory $names[1]))
try {
    $entry = $zip.GetEntry('native-release.json')
    if (!$entry) { throw 'Missing native release marker' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $marker = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($marker.channel -cne 'native' -or $marker.development -ne $false -or $marker.version -cne $version -or $marker.productVersion -cne $version) {
        throw 'ZIP is not a production native build of this version'
    }
} finally { $zip.Dispose() }
if ($ValidateOnly) { Write-Output 'Native release artifacts verified (no GitHub changes).'; return }
function Read-Release {
    # The REST by-tag endpoint can return 404 for drafts. gh resolves drafts
    # too; use its stable release ID URL to verify the uploaded assets.
    $reference = & gh release view $Tag --repo $Repository --json apiUrl 2>&1
    if ($LASTEXITCODE) {
        if (($reference | Out-String) -match 'release not found|HTTP 404') { return $null }
        throw "Cannot resolve release: $reference"
    }
    $apiUrl = ($reference | Out-String | ConvertFrom-Json).apiUrl
    if (!$apiUrl.StartsWith("https://api.github.com/repos/$Repository/releases/")) { throw 'Unexpected release API URL' }
    $response = & gh api $apiUrl 2>&1
    if ($LASTEXITCODE) { throw "Cannot read release: $response" }
    return ($response | Out-String | ConvertFrom-Json)
}
function Test-Assets($release) {
    if (@($release.assets).Count -ne $names.Count) { return $false }
    foreach ($name in $names) {
        $assets = @($release.assets | Where-Object { $_.name -ceq $name })
        if ($assets.Count -ne 1 -or $assets[0].digest -cne "sha256:$($hashes[$name])" -or
            $assets[0].size -ne (Get-Item -LiteralPath (Join-Path $directory $name)).Length) { return $false }
    }
    return $true
}
$release = Read-Release
if ($release -and !$release.draft) {
    if (!(Test-Assets $release)) { throw 'A published release already exists with different assets; publish a new version.' }
    Write-Output 'Identical release is already published.'
    return
}
if ($release -and @($release.assets | Where-Object { $_.name -notin $names }).Count) {
    throw 'Existing draft contains unrelated assets; refusing to replace another release.'
}
$notes = @"
## 下载 / Downloads

- [安装版（推荐） / Windows installer](https://github.com/$Repository/releases/download/$Tag/$($names[0]))
- [解压版 / Windows ZIP](https://github.com/$Repository/releases/download/$Tag/$($names[1]))

Windows x64 · C++ / Qt Quick · 模型在应用内单独下载。
Models are downloaded separately in the app.
"@
$entry = Get-Content "$repo/src/shared/changelog.json" -Raw | ConvertFrom-Json | Where-Object { $_.version -eq $version } | Select-Object -First 1
if ($entry) { $notes += "`n`n## 更新日志`n`n" + (($entry.changes | ForEach-Object { "- $_" }) -join "`n") }
$notesFile = [IO.Path]::GetTempFileName()
try {
    $notes | Set-Content -LiteralPath $notesFile -Encoding utf8
    if (!$release) {
        & gh release create $Tag --repo $Repository --verify-tag --draft --title "Vocal v$version" --notes-file $notesFile
        if ($LASTEXITCODE) { throw 'Cannot create release draft' }
    }
    if (!(Test-Assets $release)) {
        $files = @($names | ForEach-Object { Join-Path $directory $_ })
        & gh release upload $Tag @files --repo $Repository --clobber
        if ($LASTEXITCODE) { throw 'Asset upload failed; release remains a draft' }
    }
    $verified = $false
    for ($attempt = 0; $attempt -lt 3; ++$attempt) {
        $release = Read-Release
        if (Test-Assets $release) { $verified = $true; break }
        if ($attempt -lt 2) { Start-Sleep -Seconds 2 }
    }
    if (!$verified) { throw 'GitHub asset size/SHA-256 verification failed; release remains a draft' }
    & gh release edit $Tag --repo $Repository --draft=false --latest --title "Vocal v$version" --notes-file $notesFile
    if ($LASTEXITCODE) { throw 'Cannot publish verified release' }
    $published = Read-Release
    if ($published.draft -or !(Test-Assets $published)) { throw 'Published release verification failed' }
    Write-Output "Published https://github.com/$Repository/releases/tag/$Tag"
} finally {
    Remove-Item -LiteralPath $notesFile -Force
}
