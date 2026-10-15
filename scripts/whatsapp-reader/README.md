# Lector local del canal IGC–UP

Complemento opcional para el Atlas. Consulta exclusivamente el canal público `0029VbAUotm2ZjCgDnlGAZ08`. No envía mensajes de WhatsApp ni utiliza un modelo de IA. Usa whatsapp-web.js y un Chrome instalado, con una sesión vinculada mediante QR.

## Funcionamiento

1. `reader.cjs` mantiene WhatsApp Web en segundo plano y ofrece una API protegida, solo en `127.0.0.1`.
2. `harvest.py`, ejecutado cada hora por Hermes con `--no-agent`, consulta el canal, conserva publicaciones y correcciones en SQLite y envía lotes pendientes al Worker.
3. Cloudflare valida el token y el canal, guarda publicaciones y revisiones en SQLite y difunde los cambios a los visitantes por el WebSocket existente. Un fallo de envío deja los mensajes pendientes para el próximo intento.

Los reportes del canal actualmente no incluyen coordenadas numéricas. Se conservan sin inventarlas. Se pueden asociar a un evento geolocalizado si la coincidencia es recíproca y única: diferencia máxima de 2 segundos, 0,2 de magnitud y 3 km de profundidad. Las coincidencias ambiguas quedan fuera del mapa. La ficha indica que el canal no publicó coordenadas. Es otra vía de publicación del mismo IGC–UP, no una medición independiente.

La consulta inicial intenta cubrir ayer y hoy, hasta 500 mensajes y ocho páginas. WhatsApp puede limitar el historial disponible; no se garantiza recuperar todo el archivo del canal. Después de una suspensión prolongada pueden faltar mensajes no accesibles ya en el historial. Las publicaciones recuperadas se conservan aunque dejen de aparecer en las respuestas.

## Configuración local

La configuración y la sesión deben estar fuera del repositorio, por ejemplo `%LOCALAPPDATA%\hermes\atlas-whatsapp\`:

- `config.json`: `local_token` aleatorio de 64 caracteres hexadecimales, `local_port` (38741), rutas absolutas `browser_path`, `node_path`, `reader_path`, `ingest_url` y `ingest_token`.
- `session/`: sesión privada del navegador; nunca publicar ni compartir.
- `messages.sqlite3`: publicaciones del canal, hashes y confirmación de envío.
- `harvest.jsonl`: resultado de cada cosecha, sin tokens.

Instalar con `PUPPETEER_SKIP_DOWNLOAD=true npm ci` en esta carpeta. Iniciar `node reader.cjs RUTA_ABSOLUTA_CONFIG`. La página local `/setup?key=...` muestra el QR; su clave se deriva como SHA-256 de `local_token + ':setup'` y solo sirve para vinculación/estado, no para leer datos ni detener el servicio. La API del canal requiere el token local completo.

El Worker requiere el secreto `WHATSAPP_INGEST_TOKEN`. Ese valor solo se instala como secreto de Cloudflare y en la configuración local. Nunca debe incorporarse al HTML, al Service Worker o a Git.

Hermes ejecuta un pequeño script bajo su carpeta `scripts`, que llama a `harvest.py`. Programación: `0 * * * *`, `--no-agent --deliver local --failure-deliver local`. La computadora y el gateway de Hermes deben estar encendidos. El script reinicia el lector si no está funcionando y espera hasta que la sesión esté lista. Una sesión revocada exige volver a vincular mediante QR.

## Lectura pública

- `/canal.json`: reportes normalizados archivados del canal, con coordenadas nulas cuando no se publicaron.
- `/historico.json?provider=IGC-WHATSAPP`: mismo archivo con filtros de fecha, paginación y revisiones.
- `/diagnostico.json`: última lectura del canal y cantidad de reportes sin asociación geográfica.

No hay cargos de actores de extracción ni de modelos de IA por ejecutar este colector. Sigue utilizando los recursos de tu computadora y el servicio Cloudflare existente. Cambios de WhatsApp Web pueden requerir mantenimiento de la compatibilidad del lector.
