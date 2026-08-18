<#
.SYNOPSIS
  Instala el panel ALFA-DEO completo en una computadora con Windows 10.

.DESCRIPTION
  Se corre UNA VEZ, despues de clonar el repo. Deja funcionando:

    - PostgreSQL local, con la base del panel
    - el panel compilado y arrancando solo al prender la maquina
    - respaldos diarios de la base
    - los comandos de operacion y los accesos del mostrador

  TODO vive en esta computadora. No hay nube: la base es local y el panel
  solo se alcanza desde aqui (o desde la red, si no usas -SinRed).

  Es idempotente: se puede volver a correr sin romper nada. Sirve para
  reparar una instalacion o para regenerar los comandos.

.EXAMPLE
  git clone https://github.com/Konekt-ai/alfadeo-panel.git C:\alfadeo\panel
  cd C:\alfadeo\panel
  powershell -ExecutionPolicy Bypass -File instalacion\instalar.ps1

.PARAMETER Raiz
  Donde van PostgreSQL, Node, los logs y los respaldos. Fuera del repo,
  para que "git reset --hard" nunca los toque. Por omision C:\alfadeo.

.PARAMETER Puerto
  Puerto del panel. Por omision 3002.

.PARAMETER PuertoBase
  Puerto de PostgreSQL. Por omision 5433, para no pelearse con otro
  PostgreSQL que ya estuviera instalado.

.PARAMETER SinRed
  Deja el panel accesible SOLO desde esta computadora: no abre el puerto en
  el firewall ni marca la red como privada. Usalo si la maquina se conecta
  a una red compartida o institucional.

.PARAMETER RespaldosEn
  Carpeta de respaldos. Ponla en otro disco o en una carpeta que se
  sincronice sola: un respaldo en el mismo disco no salva de un disco muerto.
#>
param(
  [string]$Raiz        = "C:\alfadeo",
  [int]   $Puerto      = 3002,
  [int]   $PuertoBase  = 5433,
  [switch]$SinRed,
  [string]$RespaldosEn = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

. "$PSScriptRoot\comun.ps1"

$NODE_VER = "v24.19.0"

$cfg = [pscustomobject]@{
  Panel  = Split-Path $PSScriptRoot -Parent
  Raiz   = $Raiz
  Puerto = $Puerto
  Tarea  = "ALFA-DEO Panel"
}

function Titulo($t) {
  Write-Output ""
  Write-Output ("=== " + $t + " " + ("=" * [Math]::Max(0, 56 - $t.Length)))
}

Write-Output ""
Write-Output "  Panel ALFA-DEO - instalacion"
Write-Output ("  repo:   " + $cfg.Panel)
Write-Output ("  raiz:   " + $cfg.Raiz)
Write-Output ("  panel:  puerto " + $cfg.Puerto)
Write-Output ("  base:   puerto " + $PuertoBase)

New-Item -ItemType Directory -Force -Path $cfg.Raiz, (Join-Path $cfg.Raiz "tmp") | Out-Null
Save-Config $cfg

# ==================================================================== 1 ===
Titulo "1/9  Node"

$nodeDir = Join-Path $cfg.Raiz "node"
if (Test-Path (Join-Path $nodeDir "node.exe")) {
  Write-Output ("ya estaba: " + (& (Get-NodeExe $cfg) --version))
} else {
  # Node va PORTABLE, no con el MSI: winget puede estar roto y el instalador
  # pide elevacion que una sesion SSH no siempre tiene. El zip no necesita
  # permisos y se desinstala borrando la carpeta.
  $url = "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-win-x64.zip"
  $zip = Join-Path $cfg.Raiz "tmp\node.zip"
  Write-Output "descargando Node $NODE_VER (~30 MB)..."
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 900

  $destTmp = Join-Path $cfg.Raiz "tmp\node"
  if (Test-Path $destTmp) { Remove-Item $destTmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $destTmp -Force
  $extraido = Get-ChildItem $destTmp -Directory | Select-Object -First 1
  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  Move-Item $extraido.FullName $nodeDir
  Remove-Item $zip, $destTmp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output ("instalado: " + (& (Get-NodeExe $cfg) --version))
}

# "next build" lanza procesos hijos que invocan "node" por nombre, no por
# ruta completa: sin esto en el PATH, la compilacion falla.
$env:Path = "$nodeDir;" + $env:Path
Write-Output ("PATH usuario: " + (Add-AlPath -Carpeta $nodeDir -Ambito "User"))

# ==================================================================== 2 ===
Titulo "2/9  PostgreSQL"

& "$PSScriptRoot\instalar-postgres.ps1" -Raiz $cfg.Raiz -Puerto $PuertoBase
if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar PostgreSQL." }

# ==================================================================== 3 ===
Titulo "3/9  Tablas y funciones"

& "$PSScriptRoot\instalar-base.ps1" -Raiz $cfg.Raiz
$baseLista = ($LASTEXITCODE -eq 0)
if (-not $baseLista) {
  Write-Output ""
  Write-Output "  La instalacion sigue, pero el panel NO va a servir hasta que"
  Write-Output "  la base este completa."
}

# ==================================================================== 4 ===
Titulo "4/9  Dependencias"

Set-Location $cfg.Panel
$npm = Get-NpmCmd $cfg

# "npm ci" y no "npm install": instala exactamente lo que dice el lockfile y
# no lo reescribe. Con "install", npm ensucia el repo en cada corrida.
& $npm ci --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw "npm ci fallo. Revisa que package-lock.json este al dia con package.json." }
Write-Output "dependencias instaladas"

# ==================================================================== 5 ===
Titulo "5/9  Compilacion"

& $npm run build
if ($LASTEXITCODE -ne 0) { throw "La compilacion fallo." }
Write-Output "compilado"

# ==================================================================== 6 ===
Titulo "6/9  Arranque automatico"

& "$PSScriptRoot\registrar-tarea.ps1" -Raiz $cfg.Raiz
if ($LASTEXITCODE -ne 0) { throw "No se pudo registrar la tarea de arranque." }

# ==================================================================== 7 ===
Titulo "7/9  Respaldos"

if ($RespaldosEn -eq "") { $RespaldosEn = Join-Path $cfg.Raiz "respaldos" }

$accionR = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"" +
             (Join-Path $PSScriptRoot "respaldo.ps1") + "`" -Raiz `"" + $cfg.Raiz + "`" -Destino `"" + $RespaldosEn + "`"")
# A la 1 de la manana: la caja ya cerro y nadie esta capturando.
$dispR = New-ScheduledTaskTrigger -Daily -At 1:00AM
$prinR = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$optsR = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName "ALFA-DEO Respaldo" -Action $accionR -Trigger $dispR `
  -Principal $prinR -Settings $optsR -Description "Respaldo diario de la base" -Force | Out-Null
Write-Output ("tarea 'ALFA-DEO Respaldo': diario a la 1:00 -> " + $RespaldosEn)

if ($baseLista) {
  Write-Output "haciendo el primer respaldo..."
  & "$PSScriptRoot\respaldo.ps1" -Raiz $cfg.Raiz -Destino $RespaldosEn
}

# ==================================================================== 8 ===
Titulo "8/9  Red"

if ($SinRed) {
  Remove-NetFirewallRule -DisplayName "ALFA-DEO Panel" -ErrorAction SilentlyContinue
  Write-Output "-SinRed: el panel solo se alcanza desde esta computadora."
} else {
  # La WiFi de una oficina suele venir marcada como Publica, y en ese perfil
  # Windows bloquea todo lo entrante: la regla no aplicaria. Se marca como
  # Privada, que es lo que es. Se prefiere esto a abrir el puerto en Publico,
  # que esta pensado para redes en las que no confias.
  try {
    $perfil = Get-NetConnectionProfile | Select-Object -First 1
    if ($perfil -and $perfil.NetworkCategory -eq "Public") {
      Set-NetConnectionProfile -InterfaceIndex $perfil.InterfaceIndex -NetworkCategory Private
      Write-Output ("red '" + $perfil.Name + "': Publica -> Privada")
    } elseif ($perfil) {
      Write-Output ("red '" + $perfil.Name + "': " + $perfil.NetworkCategory)
    }
  } catch {
    Write-Output ("no se pudo cambiar el perfil de red: " + $_.Exception.Message)
  }

  try {
    Remove-NetFirewallRule -DisplayName "ALFA-DEO Panel" -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName "ALFA-DEO Panel" -Direction Inbound -Action Allow `
      -Protocol TCP -LocalPort $cfg.Puerto -Profile Private,Domain -ErrorAction Stop | Out-Null
    Write-Output ("firewall: puerto " + $cfg.Puerto + " abierto en redes privadas")
  } catch {
    Write-Output "firewall: NO se pudo abrir el puerto. Corre esto una vez como administrador:"
    Write-Output ("  New-NetFirewallRule -DisplayName 'ALFA-DEO Panel' -Direction Inbound -Action Allow -Protocol TCP -LocalPort " + $cfg.Puerto + " -Profile Private,Domain")
  }
}
# La BASE nunca se asoma a la red, con o sin -SinRed: escucha solo en
# localhost y no hay regla de firewall para ella. Solo el panel le habla.

# ==================================================================== 9 ===
Titulo "9/9  Comandos y accesos"

& "$PSScriptRoot\comandos.ps1" -Raiz $cfg.Raiz
& "$PSScriptRoot\accesos.ps1"  -Raiz $cfg.Raiz

# --------------------------------------------------------------- arrancar -
Titulo "Arrancando"

Stop-Panel $cfg
if (-not (Start-Panel -Cfg $cfg -EsperaSeg 90)) {
  throw ("El panel no respondio. Revisa el log: " + (Get-LogPath $cfg))
}

$ip = Get-IpLan
Write-Output ""
Write-Output "  LISTO"
Write-Output ""
Write-Output ("  En esta computadora:  http://localhost:" + $cfg.Puerto)
if ($ip -and -not $SinRed) {
  Write-Output ("  Desde la red:         http://" + $ip + ":" + $cfg.Puerto)
}
Write-Output ("  Base de datos:        localhost:" + $PuertoBase + " (solo local)")
Write-Output ("  Respaldos:            " + $RespaldosEn)
Write-Output ("  Log:                  " + (Get-LogPath $cfg))
Write-Output ""
Write-Output "  Comandos (abre una consola NUEVA para que tome el PATH):"
Write-Output "    estado       ver como va todo"
Write-Output "    actualizar   traer cambios de GitHub y reiniciar"
Write-Output "    reiniciar    reiniciar sin traer cambios"
Write-Output "    respaldo     respaldar la base ahora"
Write-Output "    log          ultimas lineas del log"
Write-Output ""
if (-not $baseLista) {
  Write-Output "  FALTA la base de datos. Corre: instalar-base"
  Write-Output ""
}
