<#
.SYNOPSIS
  Registra la tarea que levanta el panel al prender la computadora.

.DESCRIPTION
  Se llama desde instalar.ps1, pero tambien sirve suelto para reparar el
  arranque sin volver a compilar.
#>
param([string]$Raiz = "C:\alfadeo")

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\comun.ps1"

$cfg     = Get-Config -Raiz $Raiz
$iniciar = Join-Path $cfg.Raiz "iniciar-panel.ps1"
$log     = Get-LogPath $cfg

# El script de arranque se GENERA con las rutas absolutas ya resueltas, en
# vez de vivir en el repo: asi la linea de comando de la tarea no depende de
# donde quedo clonado el proyecto, y "git reset --hard" nunca lo toca.
#
# Lleva guarda de puerto: si ya hay algo escuchando, no levanta un segundo
# servidor. Eso hace inofensivo que la tarea se dispare dos veces.
$arranque = @'
$RAIZ   = "__RAIZ__"
$PANEL  = "__PANEL__"
$LOG    = "__LOG__"
$PUERTO = __PUERTO__

if (Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue) { exit 0 }

Set-Location $PANEL
$env:Path = "$RAIZ\node;$RAIZ\git\cmd;" + $env:Path
$env:NODE_ENV = "production"

# El log se rota solo a los 5 MB: nadie lo revisa y no debe comerse el disco.
if ((Test-Path $LOG) -and ((Get-Item $LOG).Length -gt 5MB)) { Remove-Item $LOG -Force }
"=== arranque $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding UTF8 $LOG

# "next start" directo con node, no "npm run start": npm mete un cmd.exe de
# por medio y despues el proceso hijo queda huerfano ocupando el puerto.
& "$RAIZ\node\node.exe" "$PANEL\node_modules\next\dist\bin\next" start -p $PUERTO *>> $LOG
'@

$arranque = $arranque.Replace("__RAIZ__",   $cfg.Raiz).
                      Replace("__PANEL__",  $cfg.Panel).
                      Replace("__LOG__",    $log).
                      Replace("__PUERTO__", [string]$cfg.Puerto)

Set-Content -Path $iniciar -Value $arranque -Encoding UTF8
Write-Output ("generado: " + $iniciar)

$accion = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"" + $iniciar + "`"")

# Dos disparadores. "Al arrancar" es el que importa: si se reinicia la
# maquina en remoto y nadie entra al escritorio, con solo "al iniciar sesion"
# el panel se queda abajo.
$t1 = New-ScheduledTaskTrigger -AtStartup
$t2 = New-ScheduledTaskTrigger -AtLogOn

# SYSTEM no necesita contrasena guardada, que es lo que obligaria correr "al
# arrancar" con una cuenta normal.
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$opts = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

# Nada de "schtasks /Delete" antes: si la tarea no existe, PowerShell 5.1
# convierte su stderr en un error terminante y aborta. El -Force ya
# sobrescribe la tarea anterior.
Register-ScheduledTask -TaskName $cfg.Tarea -Action $accion -Trigger $t1,$t2 `
  -Principal $principal -Settings $opts `
  -Description ("Panel ALFA-DEO en http://localhost:" + $cfg.Puerto) -Force | Out-Null

Write-Output ("tarea '" + $cfg.Tarea + "': corre como SYSTEM al prender la computadora")
