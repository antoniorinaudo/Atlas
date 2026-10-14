# Catálogo con fuentes complementarias

Se mantiene el archivo IGC–UP. USGS y EMSC se guardan en `atlas_observations`, con identificador del proveedor, UID combinado e historial en `atlas_observation_revisions`. Los estados y puntos de recuperación se guardan en `atlas_provider_state`. Las tablas anteriores y sus datos no se eliminan.

## Actualización y recuperación

La primera consulta externa recupera siete días de calendario de Panamá. Las siguientes usan `updatedafter`, solape de diez minutos y páginas de 1.000 registros. El punto de recuperación corresponde al inicio de la consulta; solo avanza tras una respuesta completa y una transacción confirmada. Respuestas idénticas no escriben observaciones ni revisiones. Una respuesta vacía no borra el archivo. Se conserva el histórico fuera de la ventana; las revisiones externas se consultan para la ventana activa.

La región es 6–10.5° N y 83.5–77° O: Panamá y su entorno marino y fronterizo. No se atribuyen eventos marinos a un distrito terrestre cercano. Cada proveedor mantiene sus fechas reales, estado y reintentos, con espera creciente hasta diez minutos. Un fallo del IGC–UP no detiene los otros proveedores.

EMSC entrega inserciones y modificaciones por WebSocket al backend. Se filtra la región, persiste el reporte y transmite el cambio a visitantes. La alarma intenta restablecer la conexión; la API incremental recupera mensajes perdidos. USGS usa consultas incrementales aproximadamente cada minuto. Continúan las alarmas persistentes para recuperación; no hay cron de GitHub ni Cloudflare ni garantía de latencia cero.

`MULTI_SOURCE=true` activa la integración. `EMSC_STREAM=true` activa la conexión saliente: mantiene el Durable Object activo mientras está abierta, por lo que no aplica hibernación en ese período. Los visitantes conservan su WebSocket de lectura existente. El diagnóstico informa estados separados, conexión EMSC y consultas realizadas.

## Asociación y presentación

Una asociación nueva requiere hasta 20 segundos de diferencia de hora de origen, 25 km de distancia y 1.2 de diferencia de magnitud, con una única coincidencia posible en ambos sentidos y un reporte por proveedor en cada grupo. Son criterios heurísticos, no confirmación sismológica. Los casos ambiguos permanecen separados. Una asociación aceptada conserva su UID tras reinicios y revisiones. Cuando vuelve IGC–UP puede incorporarse a un grupo externo inequívoco sin generar un segundo punto o aviso.

Orden del reporte principal: IGC–UP, USGS, EMSC. Una caída no sobrescribe una medición guardada. **No se promedian magnitudes.** La comparación conserva tipo de magnitud, hora, profundidad, coordenadas, agencia, revisión y verificación. IGC–UP no publica un tipo en la tabla utilizada: se indica «tipo no informado». EMSC no proporciona aquí estado de revisión, por lo que no se deduce que un evento sea revisado. Varias fuentes pueden compartir agencias; no equivalen a mediciones independientes.

Las cifras y tendencias corresponden al catálogo combinado, cuya cobertura difiere del catálogo local. No constituyen una serie homogénea de detección ni una predicción. El primer llenado de cada proveedor establece una base sin notificaciones históricas. Las revisiones y reportes asociados al UID existente no crean otro push. Los avisos nuevos identifican el proveedor principal y conservan el umbral elegido por la suscripción.

## API de lectura

- `/sismos.json`: catálogo combinado; cada evento incluye `provider`, `mag_type`, `observations`, `association` y UID estable.
- `/historico.json?provider=USGS&from=2026-10-08&to=2026-10-14`: archivo USGS paginado. También acepta `provider=EMSC`. Sin proveedor conserva el archivo IGC–UP. Máximo 500 registros por página; continuar con `next_offset`.
- `/revisiones.json?uid=...`: versiones IGC–UP y campo `sources` con versiones externas asociadas al UID combinado.
- `/diagnostico.json`: estado independiente de cada proveedor, consultas, escritura de observaciones y eventos con comparación.

## Créditos y validación

Se mantienen los créditos del Instituto de Geociencias de la Universidad de Panamá. USGS figura como proveedor adicional. **EMSC SeismicPortal: CC BY 4.0**, atribución y enlace en el pie. El Atlas transforma los reportes mediante normalización y asociación aproximada. La licencia MIT del código no se extiende a datos de terceros.

Referencias: [EMSC API y licencia](https://www.seismicportal.eu/fdsn-wsevent.html), [EMSC WebSocket](https://www.seismicportal.eu/realtime.html), [USGS API](https://earthquake.usgs.gov/fdsnws/event/1/), [USGS GeoJSON](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).

Pruebas: `node --test cloudflare/catalog-store.test.mjs cloudflare/worker.test.mjs cloudflare/push.test.mjs cloudflare/multi-source.test.mjs`.
