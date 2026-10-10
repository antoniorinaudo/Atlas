// Public endpoint only. Never put Cloudflare credentials in browser code.
window.ATLAS_CONFIG = Object.freeze({
  dataUrl: 'https://atlas-sismico-panama-datos.ptydev.workers.dev/sismos.json',
  diagnosticUrl: 'https://atlas-sismico-panama-datos.ptydev.workers.dev/diagnostico.json',
  pollMs: 60000
});
