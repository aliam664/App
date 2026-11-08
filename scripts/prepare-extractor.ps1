$ErrorActionPreference = 'Stop'
# Deliberately pinned release and installer checksum. Review before updating.
$version = '26.05'
$expected = 'fd99e86f57d8f429ef5ed045bf98315af962e2309b0f1ba87a147a44c71647d0'
$installer = Join-Path $env:TEMP 'uhm-7zip-pinned.exe'
Invoke-WebRequest "https://github.com/ip7z/7zip/releases/download/$version/7z2605-x64.exe" -OutFile $installer
if ((Get-FileHash $installer -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw '7-Zip installer checksum mismatch' }
$target = Join-Path $PSScriptRoot '../src-tauri/resources/extractor'
New-Item -ItemType Directory -Force $target | Out-Null
# Extract the official installer; NEVER run it. The runner must already have 7-Zip.
& 7z x $installer "-o$target" -y '7z.exe' '7z.dll' 'License.txt' 'copying.txt'
if ($LASTEXITCODE -ne 0) { throw 'Failed to extract approved tools' }
foreach ($entry in @(@('7z.exe','UHM_EXTRACTOR_EXE_SHA256'),@('7z.dll','UHM_EXTRACTOR_DLL_SHA256'))) {
  $hash = (Get-FileHash (Join-Path $target $entry[0]) -Algorithm SHA256).Hash.ToLower()
  [Environment]::SetEnvironmentVariable($entry[1],$hash,'Process')
  if ($env:GITHUB_ENV) { "$($entry[1])=$hash" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8 }
}
Remove-Item $installer
