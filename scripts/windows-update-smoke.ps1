# Destructive only to this disposable GitHub runner's test installation.
# The acs.exe process below is a renamed Windows cmd.exe fixture, NOT Assetto Corsa.
param([Parameter(Mandatory=$true)][string]$ExpectedVersion)
$ErrorActionPreference = 'Stop'
function Assert($condition, [string]$message) { if (-not $condition) { throw $message } }
function Wait-Until([scriptblock]$condition, [string]$message, [int]$seconds = 120) {
  $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
  do { if (& $condition) { return }; Start-Sleep -Seconds 1 } while ([DateTime]::UtcNow -lt $deadline)
  throw $message
}
function Version([string]$path) {
  if (-not (Test-Path $path)) { return '' }
  try { [regex]::Match((Get-Item $path).VersionInfo.ProductVersion, '^\d+\.\d+\.\d+').Value } catch { '' }
}
Assert ($env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_OS -eq 'Windows' -and $env:GITHUB_REPOSITORY -eq 'aliam664/App' -and $env:RUNNER_TEMP) 'This harness is restricted to the explicit disposable Windows CI job'
$root = Join-Path $env:RUNNER_TEMP 'uhm-real-update-smoke'
$target = Join-Path $root 'launcher'
$game = Join-Path $root 'game-fixture'
$data = Join-Path $env:LOCALAPPDATA 'com.uhm.launcher'
New-Item -ItemType Directory -Force $target, $game, "$game/content", $data | Out-Null
$settings = Join-Path $data 'settings.json'
Assert (-not (Test-Path $settings)) 'Smoke test requires a fresh disposable runner profile'
@{ game_path=$game; game_paths=@($game); autoscan=$false; download_path=''; parallel_downloads=2 } |
  ConvertTo-Json | Set-Content -Encoding utf8NoBOM $settings
$gameSentinel = Join-Path $game 'content/preserve-after-update.txt'
'Windows update test fixture; not a real game or package.' | Set-Content $gameSentinel
$settingsHash = (Get-FileHash $settings).Hash
$gameHash = (Get-FileHash $gameSentinel).Hash
$exe = Join-Path $target 'uhm-launcher.exe'
$installer = @(Get-ChildItem src-tauri/target/release/bundle/nsis/*0.0.0*x64*setup.exe)
Assert ($installer.Count -eq 1) 'Expected exactly one locally built 0.0.0 NSIS fixture'
$setup = Start-Process -FilePath $installer[0].FullName -ArgumentList @('/S', "/D=$target") -PassThru -Wait
Assert ($setup.ExitCode -eq 0) "Initial real NSIS installation failed: $($setup.ExitCode)"
Assert ((Version $exe) -eq '0.0.0') 'Initial installed binary is not the 0.0.0 fixture'
# Create only a trusted OS executable fixture to exercise the process-name deferral.
Copy-Item "$env:SystemRoot/System32/cmd.exe" "$game/acs.exe"
$blocker = Start-Process "$game/acs.exe" -ArgumentList @('/c', 'ping -n 180 127.0.0.1 > nul') -WindowStyle Hidden -PassThru
$app = $null
try {
  Assert (-not $blocker.HasExited) 'Game-process fixture did not start'
  $app = Start-Process $exe -PassThru
  $metadata = Join-Path $data 'updater/release.json'
  Wait-Until { (Test-Path $metadata) -and ((Get-Content $metadata -Raw | ConvertFrom-Json).version -eq $ExpectedVersion) } 'Launcher did not download and verify the real published update'
  Assert ((Version $exe) -eq '0.0.0') 'App changed before a safe installation point'
  # A real OS close request, not IPC or a mocked install function.
  Wait-Until { $app.Refresh(); $app.MainWindowHandle -ne 0 } 'Native launcher window never became available'
  Assert ($app.CloseMainWindow()) 'Could not close the actual native launcher window'
  Assert ($app.WaitForExit(30000)) 'Launcher did not close with a game process active'
  Start-Sleep -Seconds 3
  Assert ((Version $exe) -eq '0.0.0') 'Updater incorrectly installed while acs.exe was active'
  Assert (-not $blocker.HasExited) 'Process fixture ended before the deferral assertion'
  Stop-Process -Id $blocker.Id -Force
  # Next start must restore and reverify the cache and install without another confirmation.
  $app = Start-Process $exe -PassThru
  Wait-Until { (Version $exe) -eq $ExpectedVersion } 'Automatic next-start NSIS upgrade did not replace the installed binary' 180
  Wait-Until {
    @(Get-Process uhm-launcher -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe -and $_.Id -ne $app.Id }).Count -gt 0
  } 'Updated application did not restart automatically' 60
  Assert ((Get-FileHash $settings).Hash -eq $settingsHash) 'Updater modified saved launcher settings'
  Assert ((Get-FileHash $gameSentinel).Hash -eq $gameHash) 'Updater modified content outside the launcher installation'
  @{ ok=$true; from='0.0.0 fixture'; to=$ExpectedVersion; checks=@(
    'Real NSIS initial installation', 'Real remote download and native signature check',
    'Actual Windows window close', 'Deferral with controlled acs.exe process fixture',
    'Cached next-start automatic NSIS upgrade', 'Automatic restart', 'Settings and game-file preservation'
  ); limits='No real Assetto Corsa execution, activated license or interactive user-PC validation' } |
    ConvertTo-Json -Depth 4 | Tee-Object -FilePath "$env:RUNNER_TEMP/windows-update-result.json"
} finally {
  if ($null -ne $blocker -and -not $blocker.HasExited) { Stop-Process -Id $blocker.Id -Force -ErrorAction SilentlyContinue }
  Get-Process uhm-launcher -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}
