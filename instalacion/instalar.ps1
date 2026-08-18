<#
.SYNOPSIS
  Instala el panel ALFA-DEO en una computadora con Windows 10.

.DESCRIPTION
  Se corre UNA VEZ, despues de clonar el repo. Deja el panel compilado,
  arrancando solo al prender la maquina y alcanzable desde la red de la
  oficina.

  Es idempotente: se puede volver a correr sin romper nada. Sirve tambien
  para reparar una instalacion o para regenerar los comandos cortos.

.EXAMPLE
  git clone https://github.com/Konekt-ai/alfadeo-panel.git C:\alfadeo\panel
  cd C:\alfadeo\panel
  powershell -ExecutionPolicy Bypass -File instalacion\instalar.ps1

.PARAMETER Raiz
  Donde van Node, los logs y los comandos cortos. Fuera del repo, para que
  "git reset --hard" nunca los toque. Por omision C:\alfadeo.

.PARAMETER Puerto
  Puerto del panel. Por omision 3002.

.PARAMETER SinRed
  No abre el puerto en el firewall ni marca la red como privada: el panel
  queda accesible solo desde esta computadora. Usalo si no quieres que los
  celulares de la oficina entren.
#>
param(
  [string]$Raiz   = "C:\alfadeo",
  [int]   $Puerto = 3002,
  [switch]$SinRed
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"   # sin esto Invoke-WebRequest va lentisimo

. "$PSScriptRoot\comun.ps1"

# Version de Node fijada a proposito: que la maquina del mostrador no cambie
# de runtime sola en una actualizacion.
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
Write-Output ("  puerto: " + $cfg.Puerto)

New-Item -ItemType Directory -Force -Path $cfg.Raiz, (Join-Path $cfg.Raiz "tmp") | Out-Null
Save-Config $cfg

# ==================================================================== 1 ===
Titulo "1/8  Node"

$nodeDir = Join-Path $cfg.Raiz "node"
if (Test-Path (Join-Path $nodeDir "node.exe")) {
  Write-Output ("ya estaba: " + (& (Get-NodeExe $cfg) --version))
} else {
  # Node va PORTABLE, no con el MSI. En la maquina del cliente winget estaba
  # roto y el instalador pide elevacion que una sesion SSH no siempre tiene.
  # El zip no necesita permisos y se desinstala borrando la carpeta.
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
Titulo "2/8  Llaves de Supabase"

$envLocal = Join-Path $cfg.Panel ".env.local"
if (Test-Path $envLocal) {
  $faltantes = @()
  $txt = Get-Content $envLocal -Raw
  foreach ($v in @("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")) {
    if ($txt -notmatch ("(?m)^\s*" + $v + "\s*=\s*\S")) { $faltantes += $v }
  }
  if ($faltantes.Count -gt 0) {
    throw ".env.local existe pero le faltan valores: $($faltantes -join ', ')"
  }
  Write-Output ".env.local: presente y con las dos variables"
} else {
  Copy-Item (Join-Path $cfg.Panel ".env.example") $envLocal
  Write-Output ""
  Write-Output "  FALTA CONFIGURAR LAS LLAVES"
  Write-Output ""
  Write-Output "  Se creo $envLocal a partir de .env.example."
  Write-Output "  Abrelo y llena las dos variables con los datos de Supabase"
  Write-Output "  (Project Settings -> API). Ojo: la SERVICE ROLE key, no la anon."
  Write-Output ""
  Write-Output "    notepad $envLocal"
  Write-Output ""
  Write-Output "  Cuando este listo, vuelve a correr este script."
  Write-Output ""
  exit 1
}

# ==================================================================== 3 ===
Titulo "3/8  Base de datos"

# Las migraciones .sql NO viven en el repo (ver .gitignore y PENDIENTES.md).
# No se pueden correr desde aqui, pero si se puede DECIR cuales faltan, que
# es lo que evita descubrirlo con un cliente enfrente.
& "$PSScriptRoot\verificar-base.ps1" -Panel $cfg.Panel
if ($LASTEXITCODE -ne 0) {
  Write-Output ""
  Write-Output "  La instalacion sigue, pero el panel no va a servir hasta"
  Write-Output "  correr las migraciones que faltan."
}

# ==================================================================== 4 ===
Titulo "4/8  Dependencias"

Set-Location $cfg.Panel
$npm = Get-NpmCmd $cfg

# "npm ci" y no "npm install": instala exactamente lo que dice el lockfile y
# no lo reescribe. Con "install", npm ensucia el repo en cada corrida.
& $npm ci --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw "npm ci fallo. Revisa que package-lock.json este al dia con package.json." }
Write-Output "dependencias instaladas"

# ==================================================================== 5 ===
Titulo "5/8  Compilacion"

& $npm run build
if ($LASTEXITCODE -ne 0) { throw "La compilacion fallo." }
Write-Output "compilado"

# ==================================================================== 6 ===
Titulo "6/8  Arranque automatico"

& "$PSScriptRoot\registrar-tarea.ps1" -Raiz $cfg.Raiz
if ($LASTEXITCODE -ne 0) { throw "No se pudo registrar la tarea de arranque." }

# ==================================================================== 7 ===
Titulo "7/8  Red"

if ($SinRed) {
  Remove-NetFirewallRule -DisplayName "ALFA-DEO Panel" -ErrorAction SilentlyContinue
  Write-Output "-SinRed: no se abrio el puerto. Solo se entra desde esta computadora."
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

# ==================================================================== 8 ===
Titulo "8/8  Comandos y accesos"

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
  Write-Output ("  Desde el WiFi:        http://" + $ip + ":" + $cfg.Puerto)
}
Write-Output ("  Log:                  " + (Get-LogPath $cfg))
Write-Output ""
Write-Output "  Comandos (abre una consola NUEVA para que tome el PATH):"
Write-Output "    estado       ver como va todo"
Write-Output "    actualizar   traer cambios de GitHub y reiniciar"
Write-Output "    reiniciar    reiniciar sin traer cambios"
Write-Output "    log          ultimas lineas del log"
Write-Output ""
