<#
.SYNOPSIS
  Crea los comandos cortos (estado, actualizar, reiniciar, log) y los pone
  en el PATH.

.DESCRIPTION
  Son envoltorios .cmd en la raiz, para no teclear la linea larga de
  powershell cada vez que uno entra por SSH. Apuntan a los .ps1 del repo,
  asi que se actualizan solos con cada "git pull".
#>
param([string]$Raiz = "C:\alfadeo")

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\comun.ps1"

$cfg = Get-Config -Raiz $Raiz
$ins = Join-Path $cfg.Panel "instalacion"
$tmp = Join-Path $cfg.Raiz "tmp"

New-Item -ItemType Directory -Force -Path $cfg.Raiz, $tmp | Out-Null

# "actualizar" corre desde una COPIA en tmp. Es la unica forma segura:
# el script hace "git reset --hard" sobre el repo donde el mismo vive, y en
# Windows no se puede reemplazar un archivo que tiene un handle abierto.
# Corriendo la copia, git puede sobrescribir el original sin problema.
$actualizar = @'
@echo off
setlocal
copy /Y "__INS__\actualizar.ps1" "__TMP__\actualizar.ps1" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "__TMP__\actualizar.ps1" -Raiz "__RAIZ__" %*
'@

$estado = @'
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "__INS__\estado.ps1" -Raiz "__RAIZ__" %*
'@

$reiniciar = @'
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "__INS__\reiniciar.ps1" -Raiz "__RAIZ__" %*
'@

$log = @'
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content '__LOG__' -Tail 40"
'@

$cmds = @{
  "actualizar" = $actualizar
  "estado"     = $estado
  "reiniciar"  = $reiniciar
  "log"        = $log
}

foreach ($n in $cmds.Keys) {
  $txt = $cmds[$n].Replace("__INS__",  $ins).
                   Replace("__TMP__",  $tmp).
                   Replace("__RAIZ__", $cfg.Raiz).
                   Replace("__LOG__",  (Get-LogPath $cfg))
  # ASCII a proposito: cmd.exe interpreta los .cmd con la codepage de la
  # consola, y un acento en UTF-8 sale como basura.
  Set-Content -Path (Join-Path $cfg.Raiz ($n + ".cmd")) -Value $txt -Encoding ASCII
  Write-Output ("comando: " + $n)
}

# Machine para que sirva tambien en sesiones de SSH y para otros usuarios;
# User como respaldo si no hay permisos de administrador.
Write-Output ("PATH maquina: " + (Add-AlPath -Carpeta $cfg.Raiz -Ambito "Machine"))
Write-Output ("PATH usuario: " + (Add-AlPath -Carpeta $cfg.Raiz -Ambito "User"))
