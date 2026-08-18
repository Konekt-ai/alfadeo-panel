<#
.SYNOPSIS
  Revisa que la base de Supabase tenga todo lo que el panel necesita.

.DESCRIPTION
  Las migraciones .sql NO viven en el repositorio: describen la operacion
  del negocio y el repo es publico (ver PENDIENTES.md, seccion "Seguridad").
  Por eso este script no puede correrlas, pero si puede decir CUALES faltan,
  que es lo que evita descubrirlo con un cliente enfrente.

  Sale con codigo 0 si esta todo, 1 si falta algo.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File instalacion\verificar-base.ps1
#>
param([string]$Panel = "")

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

# Windows 10 viejo puede negociar TLS 1.0 por omision y Supabase lo rechaza.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ($Panel -eq "") { $Panel = Split-Path $PSScriptRoot -Parent }

$envLocal = Join-Path $Panel ".env.local"
if (-not (Test-Path $envLocal)) {
  Write-Output "no se puede verificar: falta $envLocal"
  exit 1
}

$url = $null; $key = $null
foreach ($linea in (Get-Content $envLocal)) {
  if ($linea -match '^\s*SUPABASE_URL\s*=\s*(.+?)\s*$')              { $url = $Matches[1].Trim('"').Trim("'") }
  if ($linea -match '^\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.+?)\s*$') { $key = $Matches[1].Trim('"').Trim("'") }
}
if (-not $url -or -not $key) {
  Write-Output "no se puede verificar: .env.local no trae SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY"
  exit 1
}

# Que aporta cada migracion. El orden importa: se corren de arriba a abajo.
$migraciones = @(
  @{ archivo = "cotizador-inteligente.sql"
     objetos = @("proveedores", "proveedor_precios", "margenes", "v_opciones_compra") },
  @{ archivo = "reunion-catalogo-sucursales.sql"
     objetos = @("sucursales", "v_catalogo") },
  @{ archivo = "reunion-operacion.sql"
     objetos = @("usuarios_panel", "movimientos_inventario", "ventas", "venta_items",
                 "pagos", "traslados", "traslado_items", "compras", "compra_items",
                 "folios", "v_alertas", "v_ventas_cobranza", "v_estado_cuenta_cliente",
                 "v_movimientos", "v_existencias") }
)

$cabeceras = @{ "apikey" = $key; "Authorization" = "Bearer $key" }

function Test-Objeto($nombre) {
  try {
    Invoke-WebRequest -Uri ($url.TrimEnd("/") + "/rest/v1/" + $nombre + "?select=*&limit=1") `
      -Headers $cabeceras -UseBasicParsing -TimeoutSec 20 | Out-Null
    return $true
  } catch {
    return $false
  }
}

# Primero: se alcanza Supabase siquiera?
if (-not (Test-Objeto "productos")) {
  Write-Output "NO se pudo consultar Supabase."
  Write-Output "  Revisa la salida a internet y que las llaves de .env.local sean correctas."
  Write-Output "  Ojo: tiene que ser la SERVICE ROLE key, no la anon."
  exit 1
}

$faltan = @()
foreach ($m in $migraciones) {
  $ausentes = @()
  foreach ($o in $m.objetos) {
    if (-not (Test-Objeto $o)) { $ausentes += $o }
  }
  if ($ausentes.Count -eq 0) {
    Write-Output ("  OK      " + $m.archivo)
  } else {
    Write-Output ("  FALTA   " + $m.archivo + "  (no existe: " + ($ausentes -join ", ") + ")")
    $faltan += $m.archivo
  }
}

if ($faltan.Count -eq 0) {
  # Bonus util: sin usuarios el POS no deja cobrar, y sin codigos de barras
  # la pistola no encuentra nada. Son los dos tropiezos tipicos del dia uno.
  try {
    $u = Invoke-WebRequest -Uri ($url.TrimEnd("/") + "/rest/v1/usuarios_panel?select=nombre") `
           -Headers $cabeceras -UseBasicParsing -TimeoutSec 20
    $usuarios = ($u.Content | ConvertFrom-Json)
    if ($usuarios.Count -le 1) {
      Write-Output ""
      Write-Output ("  AVISO: solo hay " + $usuarios.Count + " usuario(s) en usuarios_panel.")
      Write-Output "         Sin elegir cajero el POS no deja cobrar. Da de alta a la gente:"
      Write-Output "           insert into usuarios_panel (nombre, rol) values ('Ana','ventas');"
    }
  } catch { }
  exit 0
}

Write-Output ""
Write-Output "  Faltan migraciones. Los .sql no estan en el repo: pidelos a quien"
Write-Output "  administra el proyecto (ver PENDIENTES.md, seccion 'Base de datos')."
Write-Output "  Se corren pegandolos en Supabase -> SQL Editor, en este orden:"
foreach ($f in $faltan) { Write-Output ("    - " + $f) }
exit 1
