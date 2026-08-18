<#
.SYNOPSIS
  Revisa que la base local tenga todo lo que el panel necesita.

.DESCRIPTION
  Comprueba el servicio, la conexion, las tablas, las vistas, las funciones
  y las extensiones. Sale con codigo 0 si esta todo, 1 si falta algo.

  Tambien avisa de las dos cosas que en el dia uno dejan el sistema a medias
  aunque el esquema este perfecto: que no haya usuarios (sin cajero el POS
  no cobra) y que no haya codigos de barras (sin ellos la pistola no sirve).
#>
param([string]$Raiz = "C:\alfadeo")

$ErrorActionPreference = "Continue"
. "$PSScriptRoot\comun.ps1"

$cfg  = Get-Config -Raiz $Raiz
$PSQL = Join-Path $Raiz "pgsql\bin\psql.exe"

if (-not (Test-Path $PSQL)) {
  Write-Output "  PostgreSQL no esta instalado. Corre instalacion\instalar-postgres.ps1"
  exit 1
}

$svc = Get-Service "alfadeo-postgres" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne "Running") {
  Write-Output ("  el servicio alfadeo-postgres esta " + $svc.Status + " - arrancalo con: Start-Service alfadeo-postgres")
  exit 1
}

$envLocal = Join-Path $cfg.Panel ".env.local"
$url = $null
foreach ($l in (Get-Content $envLocal -ErrorAction SilentlyContinue)) {
  if ($l -match '^\s*DATABASE_URL\s*=\s*(.+?)\s*$') { $url = $Matches[1].Trim('"').Trim("'") }
}
if (-not $url) {
  Write-Output "  falta DATABASE_URL en .env.local - corre instalacion\instalar-postgres.ps1"
  exit 1
}

# Una sola consulta trae todo lo que existe: mas rapido y mas simple que
# preguntar objeto por objeto.
$consulta = @"
select 'tabla:'  || tablename  from pg_tables  where schemaname = 'public'
union all
select 'vista:'  || viewname   from pg_views   where schemaname = 'public'
union all
select 'funcion:'|| p.proname  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all
select 'ext:'    || extname    from pg_extension
"@

$r = Nativo $PSQL @($url, "-t", "-A", "-c", $consulta) -Silencioso
$hay = $r.salida -split "`n"
if ($r.codigo -ne 0) {
  Write-Output "  NO se pudo conectar a la base:"
  ($hay | Select-Object -First 3) | ForEach-Object { Write-Output ("    " + $_) }
  exit 1
}
$existe = New-Object System.Collections.Generic.HashSet[string]
foreach ($x in $hay) { if ($x.Trim()) { [void]$existe.Add($x.Trim()) } }

# Que aporta cada archivo. El orden es el orden en que se corren.
$migraciones = @(
  @{ archivo = "00-esquema-base.sql"
     objetos = @("tabla:productos","tabla:inventario","tabla:clientes","tabla:solicitudes",
                 "tabla:solicitud_items","tabla:cotizaciones","tabla:cotizacion_items",
                 "ext:pgcrypto","ext:unaccent","ext:pg_trgm") },
  @{ archivo = "cotizador-inteligente.sql"
     objetos = @("tabla:proveedores","tabla:proveedor_precios","tabla:margenes",
                 "tabla:producto_codigos","vista:v_opciones_compra") },
  @{ archivo = "reunion-catalogo-sucursales.sql"
     objetos = @("tabla:sucursales","vista:v_catalogo",
                 "funcion:parse_producto_nombre","funcion:buscar_productos","funcion:f_unaccent") },
  @{ archivo = "reunion-operacion.sql"
     objetos = @("tabla:usuarios_panel","tabla:movimientos_inventario","tabla:ventas",
                 "tabla:venta_items","tabla:pagos","tabla:traslados","tabla:traslado_items",
                 "tabla:compras","tabla:compra_items","tabla:folios",
                 "vista:v_alertas","vista:v_ventas_cobranza","vista:v_estado_cuenta_cliente",
                 "vista:v_movimientos","vista:v_existencias",
                 "funcion:registrar_movimiento","funcion:descontar_fefo",
                 "funcion:pos_registrar_venta","funcion:cancelar_venta",
                 "funcion:enviar_traslado","funcion:recibir_traslado",
                 "funcion:recibir_compra","funcion:siguiente_folio",
                 "funcion:buscar_productos_pos") }
)

$faltan = @()
foreach ($m in $migraciones) {
  $ausentes = @($m.objetos | Where-Object { -not $existe.Contains($_) })
  if ($ausentes.Count -eq 0) {
    Write-Output ("  OK      " + $m.archivo)
  } else {
    $lista = ($ausentes | ForEach-Object { ($_ -split ':')[1] }) -join ", "
    Write-Output ("  FALTA   " + $m.archivo + "  (no existe: " + $lista + ")")
    $faltan += $m.archivo
  }
}

if ($faltan.Count -gt 0) {
  Write-Output ""
  Write-Output "  Corre:  powershell -ExecutionPolicy Bypass -File instalacion\instalar-base.ps1"
  exit 1
}

# ------------------------------------------------------- datos minimos ---
$consultaDatos = @"
select
  (select count(*) from usuarios_panel where activo),
  (select count(*) from productos where activo and codigo_barras is not null),
  (select count(*) from productos where activo),
  (select count(*) from productos where activo and precio_base is not null),
  (select count(*) from inventario)
"@

$rd = Nativo $PSQL @($url, "-t", "-A", "-F", "|", "-c", $consultaDatos) -Silencioso
if ($rd.codigo -eq 0 -and $rd.salida.Trim()) {
  $p = ($rd.salida -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 1).Trim().Split('|')
  $usuarios = [int]$p[0]; $conCodigo = [int]$p[1]; $productos = [int]$p[2]
  $conPrecio = [int]$p[3]; $lotes = [int]$p[4]

  Write-Output ""
  Write-Output ("  datos: " + $productos + " productos, " + $lotes + " lotes, " + $usuarios + " usuarios")

  $avisos = @()
  if ($usuarios -eq 0) {
    $avisos += "No hay usuarios activos. Sin elegir cajero el POS no deja cobrar:"
    $avisos += "    insert into usuarios_panel (nombre, rol) values ('Ana','ventas');"
  }
  if ($productos -gt 0 -and $conCodigo -eq 0) {
    $avisos += "Ningun producto tiene codigo de barras: la pistola no va a encontrar nada."
    $avisos += "    Registralos escaneando en /verificador, o importa el catalogo de Aspel."
  } elseif ($productos -gt 0 -and $conCodigo -lt $productos) {
    $avisos += ("Codigos de barras: " + $conCodigo + " de " + $productos + " productos. Los que faltan no se pueden escanear.")
  }
  if ($productos -gt 0 -and $conPrecio -eq 0) {
    $avisos += "Ningun producto tiene precio: el POS va a empezar cada linea en cero."
  }

  if ($avisos.Count) {
    Write-Output ""
    foreach ($a in $avisos) { Write-Output ("  " + $a) }
  }
}

exit 0
