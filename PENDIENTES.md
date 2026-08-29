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
| 4 | Respetar el flujo real de compra | Producto → cantidad → precio → entrega → factura |
| 12 | Botón de WhatsApp en la web | `alfadeo-bot/web/boton-whatsapp.html`, listo para pegar |
| 15 | Redirigir al número que corresponde | Por existencia y por ciudad del cliente |
| 39 | Usar la conversación real de referencia | El bot entiende texto libre, no obliga a navegar el menú |

### En el panel (este repo)

#### Catálogo — migración `reunion-catalogo-sucursales.sql`

| # | Punto | Cómo quedó |
| --- | --- | --- |
| 17 | Ver nombre comercial, genérico, mg y presentación | Columnas en `/inventario`, derivadas del nombre de Aspel |
| 18 | Distinguir por presentación | `C/12` y `C/50` con la misma dosis son productos distintos |
| 19 | Buscar por nombre | Buscador por comercial, genérico, laboratorio o lote |
| 20 | El comercial antes que el genérico | El ranking de búsqueda le da más peso al comercial |
| 28 | Ver en qué ubicación hay | Columna Plaza y filtro Guadalajara / Monterrey |

#### Operación — migración `reunion-operacion.sql`

| # | Punto | Cómo quedó |
| --- | --- | --- |
| 3 | Contemplar que no generan IVA | `pos_registrar_venta` aplica `productos.tasa_iva` línea por línea y la congela en la venta. La mayoría sale en 0% |
| 5 | Tiempos de DHL | `src/lib/entrega.ts`: día siguiente hábil; si sale viernes llega el martes; salta los festivos del artículo 74 |
| 6 | Avisar tiempos a clientes nuevos | La fecha se compromete al cerrar la venta (`ventas.fecha_entrega`) y se muestra en el tablero y en el POS |
| 7 | Facturar desde el sistema y descontar solo | La venta nace en `/pos` y descuenta inventario en la misma transacción. El timbrado se registra en `/ventas/[id]` |
| 8 | Todos mueven el mismo inventario en tiempo real | `registrar_movimiento()` bloquea el lote antes de tocarlo. Cada movimiento va firmado con quien lo hizo |
| 10 | Sustituir el registro en papel | `/movimientos`: kardex completo con entradas, salidas y ajustes |
| 11 | Descontar desde el punto de venta | `/pos`, pensado para computadora y celular |
| 16 | Integrar de verdad el punto de venta | El POS es el mismo sistema, no un módulo aparte |
| 21 | Centralizar todo en una plataforma | Menú agrupado por trabajo: almacén, comercial, administración |
| 22 | Aprovechar los códigos de barras de Aspel | Dos caminos: `/verificador` los registra escaneando caja por caja, y `/inventario/importar` los carga en bloque desde Aspel. El POS acepta el escaneo en el mismo campo que el nombre |
| 23 | Control de lotes | Una fila de `inventario` es un lote. Las salidas son FEFO: sale primero lo que caduca antes |
| 26 | Captura de compras al recibir mercancía | `/compras`, y al recibirla crea los lotes nuevos |
| 27 | Entregas al cliente institucional | Cada entrega es una venta con folio, lotes y fecha comprometida |
| 29 | Lector de facturas | Lee el **XML del CFDI** del proveedor y precarga la compra completa |
| 30 | Estado de cuenta por cliente | `/cobranza/[clienteId]`: facturado, pagado, saldo y saldo vencido |
| 31 | Alertas de pagos pendientes | Tablero de `/inicio` y `/cobranza`, con cobranza, caducidades y reorden |
| 32 | No depender del SAT | Las alertas se calculan con `pagos` capturados en el panel. `pagos.origen` distingue lo manual de lo que venga del SAT |
| 33 | Módulo administrativo | `/ventas`: estado de cada venta, partidas, lotes, factura, pagos y saldo |
| 34 | Clientes con crédito | `clientes.dias_credito` precarga el plazo y calcula `fecha_vencimiento` al vender |
| 35 | Clientes tipo IMSS | `clientes.portal_pagos_url`: el enlace al portal vive junto al adeudo |
| 36 | Clientes que facturan con su sistema | `ventas.factura_emisor` acepta Contalink o Aspel sin recapturar la venta |
| 37 | Traslados entre plazas | `/traslados`: un documento, salida en origen y entrada en destino con el mismo lote |
| 13 | Textos más grandes | Aplicado en inventario, clientes, proveedores, solicitudes y todo lo nuevo |

---

## Falta

### 1. Timbrado real del CFDI

Hoy `/ventas/[id]` **registra** la factura (serie, folio, UUID, quién la timbró),
que es lo que permite dejar de recapturar lo que ya se facturó en Aspel o
Contalink. Lo que no hace todavía es **timbrar**.

Para timbrar desde aquí hace falta contratar un PAC (Facturama, SW Sapien,
Finkok) y agregar el llamado a su API. El dato duro ya está listo: cada venta
trae sus partidas con la tasa de IVA correcta, y `sucursales` tiene razón
social y RFC de cada empresa.

**Ojo antes de timbrar:** hay 16 productos marcados con IVA 16% porque no se
les detectó forma farmacéutica (suplementos y material de curación). Que
contabilidad los revise en el panel.

### 2. Datos que faltan cargar

Nada de esto es programación, pero sin ello el sistema opera a medias.

**Ya resuelto (29 ago 2026) — limpieza del catálogo.** El punto de venta
fallaba y la causa eran los datos, no el código. Había **281 productos para
sólo 134 nombres reales**, 40 códigos de barras asignados a más de un
producto, y lotes con `sucursal_id` nulo que el POS nunca podía ver porque
siempre filtra por plaza.

El caso que reportaron —el linezolid `7506442701794`— juntaba tres fallas: el
código estaba en dos fichas **inactivas y sin existencia**, mientras las 150
piezas vivían en **otras dos fichas sin código**, y encima sus lotes no tenían
plaza. Escanear no devolvía nada y la salida no se podía registrar.

La migración `catalogo-limpio.sql` lo dejó en **128 productos**, 0 lotes sin
plaza y 1 código repetido. De paso rescató 6 códigos varados en fichas vacías
(levetiracetam, levofloxacino, linezolid, magaldrato, pregabalina,
rivaroxabán). Dejó tres herramientas para que no se vuelva a ensuciar:
`consolidar_productos()`, `asignar_codigo_barras()` y la vista
`v_productos_duplicados`, que alimenta `/inventario/duplicados`.

Lo que sigue pendiente:

- **49 de 128 productos no tienen código de barras.** Sin código no se pueden
  escanear. Se registran pasando cajas por el lector en `/verificador`.
- **Un código repetido sin resolver:** `7506400900399` está en dos productos
  MICROBIOT distintos y **los dos tienen existencia**, así que no se pueden
  fusionar a ciegas. Necesita que alguien decida cuál se queda con el código.
- **Inventario de Monterrey** (punto 24). Todo está en GDL. MTY maneja ~25
  productos que aún no se capturan.
- **Razón social y RFC de cada plaza** (punto 9). `sucursales` los tiene
  vacíos y se necesitan para facturar: son empresas distintas.
- **Precios de venta.** `productos.precio_base` alimenta el POS; mientras esté
  vacío, la caja empieza cada línea en cero.
- **Días de crédito por cliente** (punto 34) y **portal de pagos** (punto 35).
- **Stock mínimo** (`productos.stock_minimo`) para que sirvan las alertas de
  reorden.

### 3. El bot de WhatsApp

**El bot compartía la base con el panel cuando ésta vivía en Supabase.** Ahora
la base es local y escucha sólo en `localhost`: el bot ya no la alcanza y los
puntos 1, 2, 4, 15 y 39 quedan sin funcionar hasta resolverlo.

Opciones, sin recomendación todavía porque depende de dónde corra el bot:

1. **Mover el bot a la misma computadora.** Lo más simple; ata todo a esa
   máquina y a que esté prendida.
2. **Abrir PostgreSQL al bot por un túnel** (ya hay un `cloudflared`
   instalado). Funciona, pero saca la base a internet, que es justo lo que se
   decidió no hacer.
3. **Que el bot hable con el panel por HTTP** en vez de con la base. Es lo
   más limpio, y obliga a exponer sólo lo que el bot necesita.

### 4. Automatizaciones que dependen de terceros

- **[38] Descarga semanal de reportes de Contalink.** Necesita credenciales y
  saber si Contalink expone API o sólo descarga manual.
- **[32] Conciliación con el SAT.** `pagos.origen` ya contempla `'sat'` y
  `'banco'`. Falta el proceso que descargue los CFDI recibidos y los concilie.
  Que quede claro: **el sistema no depende de esto para funcionar**, es refuerzo.
- **[29] Lector de facturas en PDF escaneado.** El XML ya se lee y es exacto.
  Un PDF escaneado necesitaría OCR (Textract, Document AI) y siempre va a ser
  menos confiable que el XML. Pídele el XML al proveedor antes de invertir ahí.

### 5. Aspel

**Dato nuevo (29 ago 2026): usan Aspel ADM, el de la nube — no Aspel SAE de
escritorio.** El cliente pasó el acceso a `adm.aspel.com.mx`. Eso invalida dos
de los tres caminos que estaban aquí:

- ~~Leer la base Firebird de Aspel SAE~~ — no hay base local, está en la nube
- ~~SDK COM en la misma máquina~~ — no hay nada instalado que llamar
- **Exportar/importar por layout** — sigue sirviendo, no necesita nada extra
- **API** — Aspel ahora es Siigo Aspel y existe *Siigo API*, cuyo caso de uso
  documentado es exactamente el nuestro: conectar un POS para generar facturas
  automáticamente. Las credenciales se generan en *Configuración → Alianzas e
  integraciones → Credenciales de integración a plataformas digitales*.

**Falta confirmar** que el plan del cliente incluya esa API: Siigo API está
documentada para Siigo Nube, que puede ser el mismo producto renombrado o no.
Hay que preguntarle a soporte de Aspel antes de comprometer trabajo.

Para integrar hacen falta las **credenciales de API** (*Usuario API* +
*Access Key*), no el login del portal: el login maestro da acceso a toda su
contabilidad, se rompe cuando alguien cambie la contraseña y no se puede
revocar sin dejar fuera al contador.

**Ojo, esto hay que hablarlo con el cliente:** Aspel ADM ya hace inventarios,
ventas, compras y CFDI, y su app *ADM Tienda* es un punto de venta. Es muy
probable que el "punto de venta que adquirieron y no aprovechan" (puntos 16 y
27 de la minuta) sea justamente ADM Tienda. Lo que el panel aporta y ADM
casi seguro no: control de lotes con FEFO (23), el catálogo farmacéutico
desglosado (17-20), el bot de WhatsApp (1, 2, 4, 15, 39), la cobranza con
alertas y portal tipo IMSS (30-35) y los traslados conservando lote (37).

**Mientras no exista la integración, las ventas del panel NO llegan a Aspel.**
Cada venta hecha aquí desfasa los dos inventarios. Hay que decidir cuál manda
antes de que la diferencia crezca.

### 6. Cotizaciones

- **[14] Arrancar una cotización desde cero**, sin una solicitud previa. Hoy
  `/solicitudes/[id]/cotizar` requiere la solicitud.

---

## Seguridad

### El panel no tiene control de acceso

Decisión tomada: va sin login. El panel consulta Supabase con la *service role
key*, que salta todas las políticas RLS.

Lo que **sí** acota el riesgo: ni el panel ni la base están en internet. Las
dos viven en la computadora del mostrador; PostgreSQL escucha sólo en
`localhost` y el panel sólo se alcanza desde la red de la oficina.

Lo que **no** acota: cualquiera conectado a la misma red que abra
`http://<ip>:3002` puede vender, mover inventario y registrar pagos.

**Cuidado con en qué red se conecta esa computadora.** El instalador marca
la red como privada y abre el puerto, y eso es razonable en la WiFi de la
oficina. En una red institucional o compartida —un campus, un coworking, un
hotel— significa exponer el panel a todos los que estén en ese segmento.
Ahí conviene instalar con `-SinRed`, que lo deja accesible sólo desde esa
computadora.

El selector de usuario del header **no es seguridad**: es una firma para saber
quién movió qué (punto 8). Cualquiera puede elegir cualquier nombre.

Opciones, en orden de esfuerzo:

1. **Cerrarlo a esa sola computadora** — quitar la regla del firewall y que
   Next escuche sólo en `localhost`. Un comando. El costo es que se pierde el
   punto 11: vender desde el celular.
2. **Contraseña compartida** — un `middleware.ts` que valida una cookie contra
   una variable de entorno. Un par de archivos. Deja pasar los celulares.
3. **Supabase Auth, un usuario por persona** — es lo que hace falta de todos
   modos para que la firma del punto 8 sea confiable.
   `usuarios_panel.auth_uid` ya está reservada para amarrar cada persona con su
   cuenta sin perder el historial de movimientos ya registrado.

Con dinero de por medio en el sistema, la 3 es la que corresponde.

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
