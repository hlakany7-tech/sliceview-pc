# Installs a built Sliceview installer silently on Windows, checks the install, opens a synthetic study with the
# installed app, then uninstalls silently and checks that everything is gone. Used by CI; safe to run by hand.
#   powershell -ExecutionPolicy Bypass -File scripts\windows-smoke.ps1 -Installer dist\Sliceview-Setup-1.0.0-x64.exe
param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
function Check($ok, $what) { if (-not $ok) { Write-Error "FAILED: $what" }; Write-Host "ok - $what" }

$dir = Join-Path $env:LOCALAPPDATA 'Programs\Sliceview'
$exe = Join-Path $dir 'Sliceview.exe'
$p = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
Check ($p.ExitCode -eq 0) "installer exit code 0 (got $($p.ExitCode))"
Check (Test-Path $exe) "Sliceview.exe installed in $dir"
Check (Test-Path (Join-Path $dir 'Uninstall Sliceview.exe')) 'uninstaller present'
Check (Test-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Sliceview.lnk')) 'Start menu shortcut'
$u = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\com.sliceview.pc'
Check ($u.DisplayName -eq 'Sliceview') 'listed in Apps and Features'
Check ((Get-ItemProperty 'HKCU:\Software\Classes\.dcm\OpenWithProgids').'Sliceview.DICOM' -ne $null) '.dcm association registered'
Check ((Get-ItemProperty 'HKCU:\Software\Classes\Directory\shell\Sliceview\command').'(default)' -like '*Sliceview.exe*') 'folder context menu registered'

# open a study with the installed app, exactly like "Open with Sliceview" on a folder
$study = Join-Path $env:RUNNER_TEMP 'sv-study'
node -e "require('./test/fixtures/dicom').writeSeries(process.argv[1], { count: 12 })" $study
$log = Join-Path $env:APPDATA 'Sliceview\logs\main.log'
if (Test-Path $log) { Remove-Item $log }
$app = Start-Process -FilePath $exe -ArgumentList "`"$study`"" -PassThru
$found = $false
for ($i = 0; $i -lt 60 -and -not $found; $i++) { Start-Sleep 1; if (Test-Path $log) { $found = (Get-Content $log -Raw) -match 'collected 12 files' } }
if (Test-Path $log) { Get-Content $log | Write-Host }
Check $found 'installed app started and read the 12-image study'
Check (-not $app.HasExited) 'app still running'
Stop-Process -Name Sliceview -Force -ErrorAction SilentlyContinue
Start-Sleep 2

$p = Start-Process -FilePath (Join-Path $dir 'Uninstall Sliceview.exe') -ArgumentList '/S' -Wait -PassThru
Start-Sleep 3 # the uninstaller copies itself to %TEMP% and finishes there
for ($i = 0; $i -lt 30 -and (Test-Path $exe); $i++) { Start-Sleep 1 }
Check (-not (Test-Path $exe)) 'program files removed'
Check (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\com.sliceview.pc')) 'removed from Apps and Features'
Check (-not (Test-Path 'HKCU:\Software\Classes\Directory\shell\Sliceview')) 'folder context menu removed'
Check (-not (Test-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Sliceview.lnk'))) 'Start menu shortcut removed'
Write-Host 'Windows smoke test passed'
