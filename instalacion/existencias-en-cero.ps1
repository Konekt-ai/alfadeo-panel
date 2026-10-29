<#
.SYNOPSIS
  Pone en cero las existencias de todo el inventario, sin borrar nada.

.DESCRIPTION
  Para cuando se va a volver a cargar el inventario desde un conteo nuevo.
  Los productos se quedan, los lotes se quedan (con su lote, caducidad y
  ubicacion), solo las piezas quedan en 0.

  No es un UPDATE a secas: cada lote se baja con un AJUSTE por
  registrar_movimiento, igual que si alguien lo hubiera contado en el anaquel.
  Asi el kardex conserva cuantas piezas habia antes del reinicio y quien lo
  hizo. Una importacion que pisara existencias borraria ese rastro.

  Sin -Aplicar solo ENSENA lo que haria. Con -Aplicar:
    1. pide confirmacion escrita
    2. saca un respaldo (si falla, no toca nada)
    3. hace todos los ajustes en UNA transaccion: o quedan todos o ninguno

  Ojo: mientras no se cargue el inventario nuevo, el POS no puede vender
  nada, porque no hay piezas. Correlo cuando ya tengas el Excel listo.

.PARAMETER Aplicar
  Hace el cambio. Sin esto solo es vista previa.

.PARAMETER Usuario
  Nombre que queda firmado en el kardex. Por omision "Sistema".

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File instalacion\existencias-en-cero.ps1
  powershell -ExecutionPolicy Bypass -File instalacion\existencias-en-cero.ps1 -Aplicar -Usuario "Diego"
#>
param(
  [string]$Raiz    = "C:\alfadeo",
  [switch]$Aplicar,
  [string]$Usuario = "Sistema"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\comun.ps1"

$cfg  = Get-Config -Raiz $Raiz
$PSQL = Join-Path $Raiz "pgsql\bin\psql.exe"

if (-not (Test-Path $PSQL)) { throw "No hay PostgreSQL en $Raiz\pgsql." }

$envLocal = Join-Path $cfg.Panel ".env.local"
$url = $null
foreach ($l in (Get-Content $envLocal -ErrorAction SilentlyContinue)) {
  if ($l -match '^\s*DATABASE_URL\s*=\s*(.+?)\s*$') { $url = $Matches[1].Trim('"').Trim("'") }
}
if (-not $url) { throw "Falta DATABASE_URL en $envLocal" }

# ------------------------------------------------------------ resumen ----
# Lo que hay, por plaza. Se ensena antes y despues del cambio.
$consultaResumen = @"
select coalesce(s.clave, '(sin plaza)'),
       count(*),
       count(*) filter (where coalesce(i.existencia, 0) <> 0),
       coalesce(sum(coalesce(i.existencia, 0)), 0),
       count(*) filter (where i.existencia < 0)
  from inventario i
  left join sucursales s on s.id = i.sucursal_id
 group by 1
 order by 1
"@

# Devuelve las filas ya partidas; quien la llama decide que imprimir. Una
# funcion de PowerShell que imprime Y devuelve algo mezcla las dos cosas en
# la misma salida.
function Leer-Resumen {
  $r = Nativo $PSQL @($url, "-t", "-A", "-F", "|", "-c", $consultaResumen) -Silencioso
  if ($r.codigo -ne 0) { throw ("No se pudo leer el inventario: " + $r.salida) }
  $filas = @()
  foreach ($l in ($r.salida -split "`n")) {
    if ($l.Trim()) { $filas += ,($l.Trim().Split('|')) }
  }
  return ,$filas
}

function Mostrar-Resumen {
  param($Filas)
  Write-Output "    plaza          lotes   con piezas      piezas   negativos"
  foreach ($p in $Filas) {
    Write-Output ("    {0,-12} {1,7} {2,12} {3,11} {4,11}" -f $p[0], $p[1], $p[2], $p[3], $p[4])
  }
}

$antes = Leer-Resumen
$pendientes = 0
foreach ($p in $antes) { $pendientes += [int]$p[2] }

Write-Output ""
Write-Output "  INVENTARIO ACTUAL"
Mostrar-Resumen $antes
Write-Output ""

if ($pendientes -eq 0) {
  Write-Output "  Todos los lotes ya estan en 0. No hay nada que hacer."
  exit 0
}

if (-not $Aplicar) {
  Write-Output ("  Se ajustarian " + $pendientes + " lotes a 0 piezas, firmados como '" + $Usuario + "'.")
  Write-Output "  Los productos y los lotes NO se borran; queda un ajuste por lote en el kardex."
  Write-Output ""
  Write-Output "  Esto fue solo una vista previa. Para hacerlo:"
  Write-Output "    powershell -ExecutionPolicy Bypass -File instalacion\existencias-en-cero.ps1 -Aplicar"
  exit 0
}

# ------------------------------------------------------------ confirmar --
Write-Output ("  VAS A PONER EN 0 LAS PIEZAS DE " + $pendientes + " LOTES.")
Write-Output "  Hasta que se cargue el inventario nuevo, el POS no va a poder vender."
Write-Output ""
$r = Read-Host "  Escribe CERO para confirmar"
if ($r -ne "CERO") { Write-Output "  cancelado, no se toco nada."; exit 1 }

# ------------------------------------------------------------ respaldo ---
# Si esto sale mal, se regresa con: respaldo.ps1 -Restaurar <archivo>
Write-Output ""
Write-Output "  respaldando antes de tocar nada..."
& "$PSScriptRoot\respaldo.ps1" -Raiz $Raiz | ForEach-Object { Write-Output ("    " + $_) }

# ------------------------------------------------------------ aplicar ----
# Va en un archivo y no con -c porque las variables de psql (:'usuario') solo
# se sustituyen al leer de archivo. El usuario entra como variable, nunca
# pegado dentro del SQL.
#
# Dentro del DO $$ ... $$ psql ya no sustituye variables; por eso el usuario
# se guarda en un parametro de la sesion y adentro se lee con current_setting.
$sql = @"
set alfadeo.usuario = :'usuario';

do `$`$
declare
  r record;
  n int := 0;
begin
  for r in
    select id, producto_id, sucursal_id, existencia, lote, ubicacion, caducidad
      from inventario
     where coalesce(existencia, 0) <> 0
     order by id
     for update
  loop
    if r.producto_id is null or r.sucursal_id is null then
      -- Sin producto o sin plaza no hay a quien firmarle el ajuste en el
      -- kardex; esos se bajan directo.
      update inventario set existencia = 0 where id = r.id;
    else
      perform registrar_movimiento(
        p_producto_id     => r.producto_id,
        p_sucursal_id     => r.sucursal_id,
        p_cantidad        => -r.existencia,
        p_tipo            => 'ajuste',
        p_lote            => r.lote,
        p_ubicacion       => r.ubicacion,
        p_caducidad       => r.caducidad,
        p_costo_unitario  => null,
        p_motivo          => 'Inventario en cero para cargar el conteo nuevo',
        p_referencia_tipo => 'manual',
        p_usuario         => current_setting('alfadeo.usuario'),
        p_inventario_id   => r.id);
    end if;
    n := n + 1;
  end loop;

  -- Los que no tenian nada capturado quedan en 0 de una vez, para que no
  -- se confundan con "no se sabe".
  update inventario set existencia = 0 where existencia is null;

  -- Si registrar_movimiento hizo algo distinto de lo esperado, se deshace
  -- todo en vez de dejar la base a medias.
  if exists (select 1 from inventario where existencia <> 0) then
    raise exception 'Quedaron lotes con piezas despues del ajuste. No se aplico nada.';
  end if;

  raise notice 'lotes ajustados a cero: %', n;
end
`$`$;
"@

$tmpDir = Join-Path $Raiz "tmp"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$tmp = Join-Path $tmpDir "existencias-en-cero.sql"
# Sin BOM: psql lo leeria como parte de la primera instruccion.
[IO.File]::WriteAllText($tmp, $sql, (New-Object Text.UTF8Encoding $false))

Write-Output ""
Write-Output "  ajustando..."
$r = Nativo $PSQL @($url, "-v", "ON_ERROR_STOP=1", "-v", ("usuario=" + $Usuario), "-1", "-q", "-f", $tmp) -Silencioso
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

foreach ($l in ($r.salida -split "`n")) {
  $t = $l.Trim()
  if (-not $t) { continue }
  if ($t -match 'NOTICE') { Write-Output ("    " + ($t -replace '^.*NOTICE:\s*', '')) }
  else { Write-Output ("    " + $t) }
}

if ($r.codigo -ne 0) {
  Write-Output ""
  Write-Output "  FALLO. La base quedo exactamente como estaba (todo iba en una transaccion)."
  exit 1
}

Write-Output ""
Write-Output "  INVENTARIO DESPUES"
Mostrar-Resumen (Leer-Resumen)
Write-Output ""
Write-Output "  Listo. Los ajustes se ven en /movimientos."
