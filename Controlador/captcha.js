// Verificación anti-robots (Cloudflare Turnstile)
const SITE_KEY = '1x00000000000000000000AA';   // CLAVE DE PRUEBA: reemplázala por tu Site Key real
const URL_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let cargando = null;

function cargarScript() {
  if (window.turnstile) return Promise.resolve();
  if (!cargando) {
    cargando = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = URL_SCRIPT;
      s.async = true;
      s.defer = true;
      s.onload = resolve;
      s.onerror = () => {
        cargando = null;
        reject(new Error('No se pudo cargar la verificación anti-robots. Revisa tu conexión.'));
      };
      document.head.appendChild(s);
    });
  }
  return cargando;
}

// Dibuja el widget dentro de "selector" y devuelve { token(), reiniciar() }
export function montarCaptcha(selector, alCambiar = () => {}) {
  const contenedor = document.querySelector(selector);
  let token = null;
  let widgetId = null;

  cargarScript()
    .then(() => {
      widgetId = window.turnstile.render(contenedor, {
        sitekey: SITE_KEY,
        language: 'es',
        theme: 'auto',
        callback: (t) => { token = t; alCambiar(true); },
        'expired-callback': () => { token = null; alCambiar(false); },
        'error-callback': () => { token = null; alCambiar(false); },
      });
    })
    .catch((err) => { if (contenedor) contenedor.textContent = err.message; });

  return {
    token: () => token,
    // Cada token sirve una sola vez: hay que pedir uno nuevo después de cada intento
    reiniciar: () => {
      token = null;
      if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
      alCambiar(false);
    },
  };
}