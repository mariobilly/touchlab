$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $appDir 'launch.vbs'
$icon = Join-Path $appDir 'assets\touchlab.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

function New-TouchLabShortcut([string]$path) {
  $s = $shell.CreateShortcut($path)
  $s.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $s.Arguments = '"' + $launcher + '"'
  $s.WorkingDirectory = $appDir
  $s.Description = 'TouchLab: realtime interactive visuals you play with your hands'
  if (Test-Path -LiteralPath $icon) { $s.IconLocation = "$icon,0" }
  $s.Save()
  Write-Output $path
}

New-TouchLabShortcut (Join-Path $desktop 'TouchLab.lnk')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'TouchLab.lnk'
New-TouchLabShortcut $startMenu
# Refresh Explorer's icon cache so the new icon shows immediately.
try { Start-Process -FilePath "$env:WINDIR\System32\ie4uinit.exe" -ArgumentList '-show' -WindowStyle Hidden } catch {}
