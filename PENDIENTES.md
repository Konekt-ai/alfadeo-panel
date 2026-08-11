# ALFA-DEO — Pendientes

Estado de los 39 puntos de la reunión. Lo que ya está hecho, lo que falta y en
qué orden conviene atacarlo.

---

## Ya está listo

### En el bot (repo `alfadeo-bot`)

| # | Punto | Cómo quedó |
| --- | --- | --- |
| 1 | Preguntar "¿requiere factura?" | Al final del flujo, con botones, y captura razón social / RFC / CP / correo |
| 2 | Responder las 3 preguntas frecuentes | Existencia: consulta inventario real. Precio: pasa a asesor. Entrega: fecha calculada |
| 3 | Contemplar que no generan IVA | `productos.tasa_iva`, 0% en medicamento de uso humano |
| 4 | Respetar el flujo real de compra | Producto → cantidad → precio → entrega → factura |
| 5 | Tiempos de DHL | Día siguiente; si sale viernes llega el martes; salta festivos de ley |
| 6 | Avisar tiempos a clientes nuevos | Va en el primer mensaje, sin que lo pidan |
| 12 | Botón de WhatsApp en la web | `alfadeo-bot/web/boton-whatsapp.html`, listo para pegar |
| 15 | Redirigir al número que corresponde | Por existencia y por ciudad del cliente |
| 39 | Usar la conversación real de referencia | El bot entiende texto libre, no obliga a navegar el menú |

### En el panel (este repo)

| # | Punto | Cómo quedó |
| --- | --- | --- |
| 17 | Ver nombre comercial, genérico, mg y presentación | Columnas en `/inventario`, derivadas del nombre de Aspel |
| 18 | Distinguir por presentación | `C/12` y `C/50` con la misma dosis son productos distintos |
| 19 | Buscar por nombre | Buscador por comercial, genérico, laboratorio o lote |
| 20 | El comercial antes que el genérico | El ranking de búsqueda le da más peso al comercial |
| 28 | Ver en qué ubicación hay | Columna Plaza y filtro Guadalajara / Monterrey |

---

## Falta — por prioridad

### 1. Inventario y punto de venta

Es la prioridad declarada del cliente (punto 11).

- **[11] Descontar existencias desde el punto de venta**, computadora o celular.
- **[8] Que todos los usuarios muevan el mismo inventario en tiempo real.**
  Hoy no hay usuarios: el panel entra con una contraseña compartida. Para saber
  *quién* movió qué hace falta migrar a Supabase Auth (ver "Seguridad").
- **[10] Sustituir el registro en papel** de entradas y salidas.
- **[22] Aprovechar los códigos de barras de Aspel** para que el POS facture
  escaneando y descuente solo. La columna `productos.codigo_barras` ya existe,
  pero está vacía: falta exportarlos de Aspel e importarlos.
- **[23] Control de lotes.** Hoy cada lote es una fila separada en `productos`,
  que es la razón por la que el bot tiene que fusionarlos para no mostrar el
  mismo producto tres veces. Lo correcto es una tabla `lotes` aparte con
  `producto_id`, lote, caducidad y existencia, y que `productos` sea el catálogo.
  **Conviene hacerlo antes que el POS**, porque el POS necesita decidir de qué
  lote descuenta (primero el que caduca antes).
- **[26] Captura de compras al recibir mercancía.**
- **[27] Entregas al cliente institucional** con control real.

### 2. Facturación

- **[7] Facturar desde el sistema y que descuente inventario automáticamente**,
  para dejar de hacerlo en Aspel.
- **[3] Aplicar la tasa de IVA por producto** al timbrar. El dato ya está en
  `productos.tasa_iva`; falta usarlo.
  **Ojo:** 16 productos quedaron marcados con IVA 16% porque no se les detectó
  forma farmacéutica (suplementos y material de curación). Que contabilidad los
  revise en el panel antes de facturar.
- **[29] Lector de facturas** para capturar documentos escaneados.

### 3. Cobranza y administración

- **[30] Estado de cuenta por cliente**: adeudos, pagos pendientes y realizados.
- **[31] Alertas de pagos pendientes** y seguimiento administrativo.
- **[32] No depender del SAT.** Que las alertas funcionen con datos propios,
  usando el SAT sólo como refuerzo.
- **[33] Módulo administrativo** con el estado de cada venta.
- **[34] Clientes con crédito** (ej. pago a 10 días) sin revisar correos a mano.
- **[35] Clientes como el IMSS**, donde hay que estar checando si ya liberaron.
- **[36] Clientes que facturan con su propio sistema** (Grajes usa Contalink).
- **[38] Automatizar la descarga semanal de reportes** de Contalink y otros.

### 4. Multiempresa

- **[9] Dos empresas independientes**, Guadalajara y Monterrey, del mismo dueño.
  La tabla `sucursales` ya existe con las dos plazas, pero falta separar la
  facturación: son razones sociales y RFC distintos.
- **[37] Traslados entre plazas** sin duplicar el trabajo administrativo:
  facturar en Guadalajara y mover el producto a Monterrey debe ser un solo
  movimiento.
- **Cargar el inventario de Monterrey.** Hoy los 149 registros están en GDL.
  Monterrey maneja ~25 productos (punto 24) que aún no se capturan. Cuando se
  carguen, basta ponerles el `sucursal_id` de MTY y el bot dirá "disponible en
  Monterrey" solo.

### 5. Interfaz

- **[13] Textos más grandes y más intuitivo.** Se aplicó en `/inventario`;
  faltan `/solicitudes`, `/clientes`, `/proveedores` y el cotizador.
- **[14] Generar cotizaciones desde el panel** sin depender de WhatsApp.
  Ya existe `/solicitudes/[id]/cotizar`; falta poder arrancar una cotización
  desde cero, sin una solicitud previa.
- **[16] Integrar de verdad el punto de venta.**
- **[21] Centralizar todo en una sola plataforma.**

### 6. Aspel

- **[25] No hay otro proveedor con integración similar a Aspel.** Es el punto
  que más diferencia al producto y el que más trabajo tiene: hay que definir si
  la integración es por exportación de archivos, por base de datos o por API.

---

## Seguridad — leer antes de publicar

### El panel entra con contraseña compartida

`PANEL_PASSWORD` protege el panel entero. Es suficiente para que no quede
abierto, pero **no identifica quién hizo cada movimiento**. En cuanto varias
personas empiecen a mover inventario (punto 8), hay que migrar a Supabase Auth
con un usuario por persona.

Si no se configura `PANEL_PASSWORD` en producción, el panel responde 503 a
propósito: es preferible que no cargue a que cargue abierto.

### El esquema de la base ya está en el historial de GitHub

`supabase/cotizador-inteligente.sql` se subió en el commit `bddcab4` y **sigue
en el historial del repositorio**, aunque ya se quitó del seguimiento y los
`.sql` estén en `.gitignore`.

Si el repositorio es **privado**, no hay nada urgente que hacer.

Si es **público**, el esquema es visible para cualquiera. Para sacarlo de verdad
hay que reescribir el historial:

```bash
pip install git-filter-repo
git filter-repo --path supabase/ --invert-paths
git push --force origin main
```

Reescribir el historial cambia todos los hashes de commit. Si alguien más tiene
clonado el repo, tendrá que volver a clonarlo.

Aclaración importante: el esquema **no contiene contraseñas ni llaves**, sólo
la estructura de las tablas. El riesgo es de información del negocio, no de
acceso: nadie entra a la base con esto.

### Dónde viven ahora los `.sql`

Los archivos siguen en `supabase/` en tu disco, pero ya no suben al repo.
Antes de que se pierdan, guárdalos en algún lado con respaldo: un repositorio
privado aparte o el gestor de contraseñas del equipo.

**Sin ellos no hay forma de reconstruir la base desde cero**, ni de que otra
persona levante el proyecto. Es el precio de sacarlos del repo, y conviene
tenerlo consciente.
