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
Assert ($ExpectedVersion -eq '0.1.3') 'Only the reviewed 0.1.2 to 0.1.3 rollout is allowed'
$installer = Join-Path $env:RUNNER_TEMP 'public-0.1.2/UHM-Launcher-0.1.2-x64-setup.exe'
Assert ((Get-FileHash $installer -Algorithm SHA256).Hash.ToLower() -eq 'c13afbcc883fed9b484df4ab9b0103da38844981c9b77c6813c8ef7c8d84b395') 'Original public 0.1.2 installer bytes differ'
$setup = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$target") -PassThru -Wait
Assert ($setup.ExitCode -eq 0) "Initial real NSIS installation failed: $($setup.ExitCode)"
Assert ((Version $exe) -eq '0.1.2') 'Initial binary must be the original public 0.1.2'
# Create only a trusted OS executable fixture to exercise the process-name deferral.
Copy-Item "$env:SystemRoot/System32/cmd.exe" "$game/acs.exe"
$blocker = Start-Process "$game/acs.exe" -ArgumentList @('/c', 'ping -n 900 127.0.0.1 > nul') -WindowStyle Hidden -PassThru
$app = $null
$firewallRule = 'UHM-disposable-update-smoke-' + [guid]::NewGuid().ToString()
try {
  Assert (-not $blocker.HasExited) 'Game-process fixture did not start'
  $app = Start-Process $exe -PassThru
  $metadata = Join-Path $data 'updater/release.json'
  Wait-Until { (Test-Path $metadata) -and ((Get-Content $metadata -Raw | ConvertFrom-Json).version -eq $ExpectedVersion) } 'Launcher did not download and verify the real published update'
  Assert ((Version $exe) -eq '0.1.2') 'App changed before a safe installation point'
  # A real OS close request, not IPC or a mocked install function.
  Wait-Until { $app.Refresh(); $app.MainWindowHandle -ne 0 } 'Native launcher window never became available'
  Assert ($app.CloseMainWindow()) 'Could not close the actual native launcher window'
  Assert ($app.WaitForExit(30000)) 'Launcher did not close with a game process active'
  Start-Sleep -Seconds 3
  Assert ((Version $exe) -eq '0.1.2') 'Updater incorrectly installed while acs.exe was active'
  Assert (-not $blocker.HasExited) 'Process fixture ended before the deferral assertion'
  # Prove rejection and startup recovery in the ACTUAL old public application.
  # Block this executable only; never edit the public feed or execute an unverified EXE.
  $cache = Join-Path $data 'updater/installer.exe'
  $goodMetadata = [IO.File]::ReadAllBytes($metadata)
  $goodInstaller = [IO.File]::ReadAllBytes($cache)
  New-NetFirewallRule -DisplayName $firewallRule -Direction Outbound -Program $exe -Action Block -Profile Any | Out-Null
  foreach ($failure in @('tampered','truncated')) {
    [IO.File]::WriteAllBytes($metadata,$goodMetadata)
    $bad = [byte[]]$goodInstaller.Clone()
    if ($failure -eq 'tampered') { $bad[0] = $bad[0] -bxor 1 } else { $bad = $bad[0..127] }
    [IO.File]::WriteAllBytes($cache,$bad)
    $app = Start-Process $exe -PassThru
    Wait-Until { $app.Refresh();$app.MainWindowHandle -ne 0 } 'Old app failed to start with a damaged cached update'
    Wait-Until { -not(Test-Path $metadata) -and -not(Test-Path $cache) } "Old app did not reject and discard $failure cache"
    Assert ((Version $exe) -eq '0.1.2') 'A damaged update changed the installed binary'
    Assert ($app.CloseMainWindow()) 'Could not close recovered old application'
    Assert ($app.WaitForExit(30000)) 'Recovered old application did not exit'
    Assert ((Get-FileHash $settings).Hash -eq $settingsHash) 'Failure recovery changed settings'
    Assert ((Get-FileHash $gameSentinel).Hash -eq $gameHash) 'Failure recovery changed content'
  }
  Remove-NetFirewallRule -DisplayName $firewallRule
  # Re-download after the two failures, still deferring while the controlled game fixture is active.
  $app = Start-Process $exe -PassThru
  Wait-Until { (Test-Path $metadata) -and ((Get-Content $metadata -Raw | ConvertFrom-Json).version -eq $ExpectedVersion) } 'Valid update was not downloaded again after failure recovery'
  Wait-Until { $app.Refresh();$app.MainWindowHandle -ne 0 } 'Recovered launcher window missing'
  Assert ($app.CloseMainWindow()) 'Could not close the re-staged launcher'
  Assert ($app.WaitForExit(30000)) 'Re-staged launcher did not exit'
  Assert ((Version $exe) -eq '0.1.2') 'Process deferral failed after recovery'
  Stop-Process -Id $blocker.Id -Force
  # Next start must restore and reverify the cache and install without another confirmation.
  $app = Start-Process $exe -PassThru
  Wait-Until { (Version $exe) -eq $ExpectedVersion } 'Automatic next-start NSIS upgrade did not replace the installed binary' 180
  Wait-Until {
    @(Get-Process uhm-launcher -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe -and $_.Id -ne $app.Id }).Count -gt 0
  } 'Updated application did not restart automatically' 60
  Assert ((Get-FileHash $settings).Hash -eq $settingsHash) 'Updater modified saved launcher settings'
  Assert ((Get-FileHash $gameSentinel).Hash -eq $gameHash) 'Updater modified content outside the launcher installation'
  @{ ok=$true; from='public immutable 0.1.2'; to=$ExpectedVersion; checks=@(
    'Real NSIS initial installation', 'Real remote download and native signature check',
    'Actual tampered and truncated cache rejection with offline startup recovery',
    'Actual Windows window close', 'Deferral with controlled acs.exe process fixture',
    'Cached next-start automatic NSIS upgrade', 'Automatic restart', 'Settings and game-file preservation'
  ); limits='No real Assetto Corsa execution, activated license or interactive user-PC validation' } |
    ConvertTo-Json -Depth 4 | Tee-Object -FilePath "$env:RUNNER_TEMP/windows-update-result.json"
} finally {
  Remove-NetFirewallRule -DisplayName $firewallRule -ErrorAction SilentlyContinue
  if ($null -ne $blocker -and -not $blocker.HasExited) { Stop-Process -Id $blocker.Id -Force -ErrorAction SilentlyContinue }
  Get-Process uhm-launcher -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}
