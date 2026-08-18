<#
.SYNOPSIS
  Instala Git portable, por si la maquina no lo trae.

.DESCRIPTION
  Normalmente no hace falta: si clonaste el repo es que ya tienes git, y
  todos los scripts usan el del sistema cuando existe.

  Sirve para el caso en que el repo llego de otra forma (un zip, una USB) y
  hay que dejar la maquina lista para "actualizar".

  Va PORTABLE por lo mismo que Node: el instalador normal pide elevacion,
  que una sesion SSH no siempre tiene, y winget puede estar roto. El .7z.exe
  es autoextraible, no instala nada en el sistema y se quita borrando la
  carpeta.
#>
param([string]$Raiz = "C:\alfadeo")

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

. "$PSScriptRoot\comun.ps1"

$GITDIR = Join-Path $Raiz "git"
$TMP    = Join-Path $Raiz "tmp"
$URL    = "https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.4/PortableGit-2.55.0.4-64-bit.7z.exe"

New-Item -ItemType Directory -Force -Path $Raiz, $TMP | Out-Null

if (Test-Path (Join-Path $GITDIR "cmd\git.exe")) {
  Write-Output ("git: ya estaba en " + $GITDIR)
} else {
  $exe = Join-Path $TMP "portablegit.exe"
  Write-Output "git: descargando (~56 MB)..."
  Invoke-WebRequest -Uri $URL -OutFile $exe -UseBasicParsing -TimeoutSec 900

  Write-Output "git: extrayendo..."
  if (Test-Path $GITDIR) { Remove-Item $GITDIR -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $GITDIR | Out-Null
  # -y acepta, -o define el destino. Es un 7-Zip autoextraible, no un setup.
  $p = Start-Process -FilePath $exe -ArgumentList "-y", ("-o`"" + $GITDIR + "`"") -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "La extraccion de PortableGit fallo (codigo $($p.ExitCode))" }
  Remove-Item $exe -Force -ErrorAction SilentlyContinue
}

$GIT = Join-Path $GITDIR "cmd\git.exe"
Write-Output ("git: " + (& $GIT --version))
Write-Output ("PATH usuario: " + (Add-AlPath -Carpeta (Join-Path $GITDIR "cmd") -Ambito "User"))
