# Only disposable CI. Installs the immutable PUBLIC 0.1.2 installer, never a fabricated older build.
param([Parameter(Mandatory=$true)][string]$Candidate,[Parameter(Mandatory=$true)][string]$ExpectedVersion)
$ErrorActionPreference='Stop'
function Assert($value,[string]$message){if(-not $value){throw $message}}
function Version([string]$path){if(Test-Path $path){[regex]::Match((Get-Item $path).VersionInfo.ProductVersion,'^\d+\.\d+\.\d+').Value}else{''}}
function Wait-Until([scriptblock]$test,[string]$message){$end=[DateTime]::UtcNow.AddSeconds(90);do{if(& $test){return};Start-Sleep -Seconds 1}while([DateTime]::UtcNow -lt $end);throw $message}
Assert ($env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_OS -eq 'Windows' -and $env:GITHUB_REPOSITORY -eq 'aliam664/App') 'Disposable Windows CI only'
Assert ($ExpectedVersion -eq '0.1.4') 'Explicit candidate version required'
$old=Join-Path $env:RUNNER_TEMP 'public-0.1.2/UHM-Launcher-0.1.2-x64-setup.exe'
Assert ((Get-FileHash $old -Algorithm SHA256).Hash.ToLower() -eq 'c13afbcc883fed9b484df4ab9b0103da38844981c9b77c6813c8ef7c8d84b395') 'Published 0.1.2 bytes changed'
$target=Join-Path $env:RUNNER_TEMP 'uhm-public-installer-upgrade'
$data=Join-Path $env:LOCALAPPDATA 'com.uhm.launcher'
Assert (-not (Test-Path "$data/settings.json")) 'Requires fresh disposable profile'
New-Item -ItemType Directory -Force $target,$data | Out-Null
$game=Join-Path $env:RUNNER_TEMP 'uhm-synthetic-game'
New-Item -ItemType Directory -Force "$game/content" | Out-Null
'synthetic content; never a real game' | Set-Content "$game/content/preserve.txt"
@{game_path=$game;game_paths=@($game);autoscan=$false;download_path='';parallel_downloads=2}|ConvertTo-Json|Set-Content -Encoding utf8NoBOM "$data/settings.json"
$settings=(Get-FileHash "$data/settings.json").Hash
$content=(Get-FileHash "$game/content/preserve.txt").Hash
$exe=Join-Path $target 'uhm-launcher.exe'
function Install([string]$setup){$p=Start-Process $setup -ArgumentList @('/S',"/D=$target") -PassThru -Wait;Assert ($p.ExitCode -eq 0) "NSIS failed: $($p.ExitCode)"}
function Open-Close {
 $app=Start-Process $exe -PassThru
 try {Wait-Until {$app.Refresh();$app.MainWindowHandle -ne 0} 'Actual application window did not open';Assert ($app.CloseMainWindow()) 'Window close failed';Assert ($app.WaitForExit(30000)) 'Application did not exit safely'} finally {if(-not $app.HasExited){Stop-Process $app.Id -Force}}
}
Install $old
Assert ((Version $exe) -eq '0.1.2') 'Not the original public installer'
Open-Close
$identity=if(Test-Path "$data/device.dpapi"){(Get-FileHash "$data/device.dpapi").Hash}else{''}
# Force a genuine Windows write/delete-sharing failure against ONLY the disposable old EXE.
# Verify the actual failed result, then prove the same installation recovers on retry.
$failedSetup=$null
$lock=[IO.File]::Open($exe,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
 $failedSetup=Start-Process (Resolve-Path $Candidate).Path -ArgumentList @('/S',"/D=$target") -PassThru
 Assert ($failedSetup.WaitForExit(60000)) 'Locked-target silent NSIS did not terminate'
 Assert ((Version $exe) -eq '0.1.2') 'Locked-target installer unexpectedly replaced the protected executable'
 Assert ((Get-FileHash "$data/settings.json").Hash -eq $settings) 'Failed install changed settings'
 Assert ((Get-FileHash "$game/content/preserve.txt").Hash -eq $content) 'Failed install changed game content'
} finally {
 $lock.Dispose()
 if($failedSetup -and -not $failedSetup.HasExited){Stop-Process $failedSetup.Id -Force}
}
Open-Close
Install (Resolve-Path $Candidate).Path
Assert ((Version $exe) -eq $ExpectedVersion) 'Upgrade binary version differs'
Open-Close
Assert ((Get-FileHash "$data/settings.json").Hash -eq $settings) 'Settings changed during upgrade'
Assert ((Get-FileHash "$game/content/preserve.txt").Hash -eq $content) 'Synthetic content changed'
if($identity){Assert ((Get-FileHash "$data/device.dpapi").Hash -eq $identity) 'Device identity changed'}
# Uninstall ONLY this disposable installation, then prove a fresh candidate install also starts.
$uninstaller=Get-ChildItem $target -Filter '*uninstall*.exe' | Select-Object -First 1
Assert ($null -ne $uninstaller) 'Expected NSIS uninstaller'
$p=Start-Process $uninstaller.FullName -ArgumentList '/S' -PassThru -Wait
Assert ($p.ExitCode -eq 0) 'Test uninstaller failed'
Wait-Until {-not(Test-Path $exe)} 'Test uninstall did not finish'
Move-Item $data (Join-Path $env:RUNNER_TEMP 'uhm-preserved-upgrade-profile')
Assert (-not(Test-Path $data)) 'Fresh installation must have a fresh application profile'
Install (Resolve-Path $Candidate).Path
Assert ((Version $exe) -eq $ExpectedVersion) 'Fresh install version differs'
Open-Close
@{ok=$true;failed_installer_exit_code=$failedSetup.ExitCode;from='public 0.1.2';to=$ExpectedVersion;checks=@('Exact original installer SHA256 and signature','Actual locked-EXE NSIS failure, old-app startup, and successful retry','Actual silent NSIS upgrade','Actual native window startup/close','Settings and synthetic content preservation','Device identity preservation when present','Fresh NSIS install and startup');limits='No active license activation, no real game, no claim of public-feed automatic rollout yet'}|ConvertTo-Json -Depth 4|Tee-Object "$env:RUNNER_TEMP/installer-upgrade-result.json"
