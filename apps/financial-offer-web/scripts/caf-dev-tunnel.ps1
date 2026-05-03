param(
  [string] $DevHost = "51.178.143.231",
  [string] $User = "ubuntu",
  [int] $ServerAliveInterval = 60,
  [switch] $RegisterLogonTask
)

$ErrorActionPreference = "Stop"

# Suite minima: Simulador Financiero + Extraccion IA
$Forwards = @(
  "18030:127.0.0.1:18030",
  "18031:127.0.0.1:18031"
)

if ($RegisterLogonTask) {
  $scriptPath = $MyInvocation.MyCommand.Path
  $taskName = "CAF-DEV-SSH-Tunnels"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Tarea '$taskName' registrada."
  exit 0
}

$sshArgs = @("-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=$ServerAliveInterval", "-o", "ServerAliveCountMax=3")
foreach ($map in $Forwards) {
  $sshArgs += "-L"
  $sshArgs += $map
}
$sshArgs += "${User}@${DevHost}"

Write-Host "Tunel CAF-DEV (Ctrl+C para detener):"
& ssh @sshArgs
