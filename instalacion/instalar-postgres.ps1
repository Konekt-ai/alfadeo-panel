<#
.SYNOPSIS
  Instala PostgreSQL en esta computadora y crea la base del panel.

.DESCRIPTION
  La base de datos vive AQUI, no en la nube. Se usa el paquete de binarios
  de PostgreSQL (un zip), no el instalador: no pide elevacion para
  descomprimirse, no mete nada en el registro mas que el servicio, y se
  desinstala borrando la carpeta.

  Decisiones que quedan tomadas aqui:

  - Escucha SOLO en localhost. La base no se asoma a la red ni con el
    firewall abierto: el unico que le habla es el panel, que corre en la
    misma maquina. Si algun dia el bot necesita entrar, se abre a proposito.
  - Puerto 5433, no el 5432 de siempre. Si la maquina ya tuviera otro
    PostgreSQL, no se pelean.
  - Contrasena generada al azar y guardada en .env.local. Nadie la teclea.
  - Se registra como SERVICIO de Windows, no como tarea programada. Postgres
    necesita apagarse limpio cuando Windows se reinicia; un servicio recibe
    ese aviso y una tarea no. Un apagon a medias corrompe la base.

.PARAMETER Raiz
  Por omision C:\alfadeo.

.PARAMETER Puerto
  Puerto de PostgreSQL. Por omision 5433.

.PARAMETER Reinstalar
  Borra la base existente y la vuelve a crear DESDE CERO. Se pierden todos
  los datos. Pide confirmacion escrita.
#>
param(
  [string]$Raiz   = "C:\alfadeo",
  [int]   $Puerto = 5433,
  [switch]$Reinstalar
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

. "$PSScriptRoot\comun.ps1"

$PG_VER   = "17.6-1"
$URL      = "https://get.enterprisedb.com/postgresql/postgresql-$PG_VER-windows-x64-binaries.zip"
$PGDIR    = Join-Path $Raiz "pgsql"
$PGDATA   = Join-Path $Raiz "pgdata"
$TMP      = Join-Path $Raiz "tmp"
$SERVICIO = "alfadeo-postgres"
$BASE     = "alfadeo"
$USUARIO  = "alfadeo"

New-Item -ItemType Directory -Force -Path $Raiz, $TMP | Out-Null

function Titulo($t) {
  Write-Output ""
  Write-Output ("--- " + $t + " " + ("-" * [Math]::Max(0, 56 - $t.Length)))
}

# ================================================================ borrar ==
if ($Reinstalar -and (Test-Path $PGDATA)) {
  Write-Output ""
  Write-Output "  ESTO BORRA LA BASE DE DATOS COMPLETA."
  Write-Output "  Se pierden ventas, inventario, clientes y cobranza."
  Write-Output ""
  $r = Read-Host "  Escribe BORRAR para confirmar"
  if ($r -ne "BORRAR") { Write-Output "  cancelado."; exit 1 }

  if (Get-Service $SERVICIO -ErrorAction SilentlyContinue) {
    Stop-Service $SERVICIO -Force -ErrorAction SilentlyContinue
    Nativo (Join-Path $PGDIR "bin\pg_ctl.exe") @("unregister", "-N", $SERVICIO) -Silencioso | Out-Null
  }
  Remove-Item $PGDATA -Recurse -Force
  Write-Output "  base borrada."
}

# =============================================================== binarios ==
Titulo "Binarios de PostgreSQL"

if (Test-Path (Join-Path $PGDIR "bin\postgres.exe")) {
  $v = & (Join-Path $PGDIR "bin\postgres.exe") --version
  Write-Output ("ya estaban: " + $v)
} else {
  $zip = Join-Path $TMP "pgsql.zip"
  Write-Output "descargando PostgreSQL $PG_VER (~315 MB, tarda)..."
  Invoke-WebRequest -Uri $URL -OutFile $zip -UseBasicParsing -TimeoutSec 3600

  Write-Output "descomprimiendo..."
  $destTmp = Join-Path $TMP "pg"
  if (Test-Path $destTmp) { Remove-Item $destTmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $destTmp -Force
  # El zip trae todo dentro de una carpeta "pgsql".
  $interior = Join-Path $destTmp "pgsql"
  if (-not (Test-Path $interior)) {
    $interior = (Get-ChildItem $destTmp -Directory | Select-Object -First 1).FullName
  }
  if (Test-Path $PGDIR) { Remove-Item $PGDIR -Recurse -Force }
  Move-Item $interior $PGDIR
  Remove-Item $zip, $destTmp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output ("instalado: " + (& (Join-Path $PGDIR "bin\postgres.exe") --version))
}

$INITDB = Join-Path $PGDIR "bin\initdb.exe"
$PGCTL  = Join-Path $PGDIR "bin\pg_ctl.exe"
$PSQL   = Join-Path $PGDIR "bin\psql.exe"

# ============================================================== cluster ===
Titulo "Base de datos"

if (Test-Path (Join-Path $PGDATA "PG_VERSION")) {
  Write-Output "el cluster ya existia; no se toca"
  $yaExistia = $true
} else {
  $yaExistia = $false

  # Contrasena del superusuario, al azar. No la teclea nadie: viaja en
  # DATABASE_URL dentro de .env.local.
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $clave = [Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', ''
  $clave = $clave.Substring(0, 24)

  $archivoClave = Join-Path $TMP "pw.txt"
  Set-Content -Path $archivoClave -Value $clave -Encoding ASCII -NoNewline

  Write-Output "creando el cluster..."
  # -A scram-sha-256 explicito: sin el, initdb avisa que activa "trust" para
  # conexiones locales, y ese aviso es justo el que abortaba el script.
  $comunes = @("-D", $PGDATA, "-U", "postgres", "--pwfile=$archivoClave",
               "--encoding=UTF8", "-A", "scram-sha-256")

  # ICU da orden alfabetico correcto en espanol: "acido" y "ACIDO" quedan
  # juntos en vez de separados por todo el abecedario. Si la version no lo
  # soporta, se cae a C, que ordena por bytes: feo pero funcional.
  $r = Nativo $INITDB ($comunes + @("--locale-provider=icu", "--icu-locale=es-MX")) -Silencioso
  if ($r.codigo -eq 0) {
    Write-Output "  intercalacion: ICU es-MX"
  } else {
    if (Test-Path $PGDATA) { Remove-Item $PGDATA -Recurse -Force }
    $r = Nativo $INITDB ($comunes + @("--locale=C")) -Silencioso
    if ($r.codigo -ne 0) { throw ("initdb fallo: " + $r.salida) }
    Write-Output "  intercalacion: C (ICU no disponible)"
  }
  Remove-Item $archivoClave -Force -ErrorAction SilentlyContinue

  # La base NO se asoma a la red. Solo el panel, desde esta misma maquina.
  $conf = Join-Path $PGDATA "postgresql.conf"
  Add-Content $conf ""
  Add-Content $conf "# --- ALFA-DEO ---"
  Add-Content $conf "listen_addresses = 'localhost'"
  Add-Content $conf "port = $Puerto"
  # Una maquina de mostrador con 8 GB: no hay que ser goloso.
  Add-Content $conf "shared_buffers = 256MB"
  Add-Content $conf "max_connections = 50"
  Add-Content $conf "log_destination = 'stderr'"
  Add-Content $conf "logging_collector = on"
  Add-Content $conf "log_directory = 'log'"
  Add-Content $conf "log_rotation_age = 1d"
  Add-Content $conf "log_rotation_size = 20MB"
  # Un mes de logs es suficiente para investigar y no llena el disco.
  Add-Content $conf "log_filename = 'postgresql-%d.log'"
  Add-Content $conf "log_truncate_on_rotation = on"
  Add-Content $conf "log_min_duration_statement = 2000"

  Set-Content -Path (Join-Path $Raiz "pg.clave") -Value $clave -Encoding ASCII -NoNewline
  Write-Output "cluster creado"
}

# ============================================================== servicio ==
Titulo "Servicio de Windows"

$svc = Get-Service $SERVICIO -ErrorAction SilentlyContinue
if (-not $svc) {
  # Servicio y no tarea programada: Windows le avisa al apagarse y Postgres
  # cierra limpio. Con una tarea, cada reinicio seria un apagon.
  Nativo $PGCTL @("register", "-N", $SERVICIO, "-D", $PGDATA, "-S", "auto", "-w") -Silencioso | Out-Null
  Start-Sleep -Seconds 2
  $svc = Get-Service $SERVICIO -ErrorAction SilentlyContinue
  if (-not $svc) { throw "No se pudo registrar el servicio. Corre esto como administrador." }
  Write-Output ("servicio '" + $SERVICIO + "' registrado")
} else {
  Write-Output ("servicio '" + $SERVICIO + "' ya existia")
}

Set-Service $SERVICIO -StartupType Automatic
if ((Get-Service $SERVICIO).Status -ne "Running") {
  Start-Service $SERVICIO
}

# Postgres tarda un momento en aceptar conexiones aunque el servicio ya diga
# "Running".
$listo = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  $r = Nativo (Join-Path $PGDIR "bin\pg_isready.exe") @("-h", "localhost", "-p", "$Puerto", "-q") -Silencioso
  if ($r.codigo -eq 0) { $listo = $true; break }
}
if (-not $listo) { throw "PostgreSQL no acepta conexiones. Revisa $PGDATA\log" }
Write-Output ("escuchando en localhost:" + $Puerto)

# ================================================== rol y base del panel ==
Titulo "Rol y base"

$clave = (Get-Content (Join-Path $Raiz "pg.clave") -Raw).Trim()
$env:PGPASSWORD = $clave

function Psql($consulta, $db = "postgres") {
  $r = Nativo $PSQL @("-h", "localhost", "-p", "$Puerto", "-U", "postgres",
                      "-d", $db, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", $consulta) -Silencioso
  return @{ ok = ($r.codigo -eq 0); salida = $r.salida.Trim() }
}

# Contrasena del rol de la aplicacion, distinta de la del superusuario.
$archivoRol = Join-Path $Raiz "pg.clave.app"
if (Test-Path $archivoRol) {
  $claveApp = (Get-Content $archivoRol -Raw).Trim()
} else {
  $b = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  $claveApp = ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]', '').Substring(0, 24)
  Set-Content -Path $archivoRol -Value $claveApp -Encoding ASCII -NoNewline
}

$existeRol = (Psql "select 1 from pg_roles where rolname = '$USUARIO'").salida
if ($existeRol -ne "1") {
  # El rol es dueno de todo y salta RLS. Las tablas traen RLS encendido sin
  # politicas (venia de Supabase): sin BYPASSRLS el panel no veria ni una
  # fila. Cuando haya un login de verdad, se cambia por politicas.
  $r = Psql "create role $USUARIO login password '$claveApp' createdb bypassrls"
  if (-not $r.ok) { throw ("No se pudo crear el rol: " + $r.salida) }
  Write-Output ("rol '" + $USUARIO + "' creado")
} else {
  Psql "alter role $USUARIO password '$claveApp'" | Out-Null
  Write-Output ("rol '" + $USUARIO + "' ya existia (contrasena actualizada)")
}

$existeBase = (Psql "select 1 from pg_database where datname = '$BASE'").salida
if ($existeBase -ne "1") {
  $r = Psql "create database $BASE owner $USUARIO"
  if (-not $r.ok) { throw ("No se pudo crear la base: " + $r.salida) }
  Write-Output ("base '" + $BASE + "' creada")
} else {
  Write-Output ("base '" + $BASE + "' ya existia")
}

# Las extensiones las tiene que crear el superusuario.
foreach ($ext in @("pgcrypto", "unaccent", "pg_trgm")) {
  $r = Psql "create extension if not exists ""$ext""" $BASE
  if (-not $r.ok) { throw ("No se pudo crear la extension " + $ext + ": " + $r.salida) }
}
Write-Output "extensiones: pgcrypto, unaccent, pg_trgm"

Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

# ============================================================== .env.local =
Titulo "DATABASE_URL"

$cfg = Get-Config -Raiz $Raiz
$envLocal = Join-Path $cfg.Panel ".env.local"
$url = "postgresql://${USUARIO}:${claveApp}@localhost:${Puerto}/${BASE}"

$lineas = @()
if (Test-Path $envLocal) {
  # Se conserva lo demas del archivo y solo se reemplaza DATABASE_URL.
  $lineas = Get-Content $envLocal | Where-Object { $_ -notmatch '^\s*DATABASE_URL\s*=' }
}
$lineas += "DATABASE_URL=$url"
Set-Content -Path $envLocal -Value $lineas -Encoding UTF8
Write-Output ("escrito en " + $envLocal)
Write-Output ("  postgresql://" + $USUARIO + ":***@localhost:" + $Puerto + "/" + $BASE)

Write-Output ""
if (-not $yaExistia) {
  Write-Output "  PostgreSQL listo. Falta crear las tablas:"
  Write-Output "    powershell -ExecutionPolicy Bypass -File instalacion\instalar-base.ps1"
} else {
  Write-Output "  PostgreSQL listo."
}
Write-Output ""
