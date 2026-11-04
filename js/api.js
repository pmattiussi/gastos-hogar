/**
 * api.js — sesión con Google y llamadas al backend de Apps Script.
 * El token de Google dura una hora; cuando vence se pide uno nuevo sin molestar
 * (Google lo renueva solo si ya iniciaste sesión antes en este celular).
 */
(function () {
  var CFG = window.APP_CONFIG || {};
  var CLAVE = 'gh_token';
  var esperandoToken = [];

  function leerToken() {
    try {
      var t = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (t && t.exp * 1000 > Date.now() + 60000) return t.valor;
    } catch (e) { /* sin almacenamiento */ }
    return null;
  }
  function guardarToken(valor) {
    var exp = 0;
    try { exp = JSON.parse(atob(valor.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp; } catch (e) { exp = Date.now() / 1000 + 3000; }
    try { localStorage.setItem(CLAVE, JSON.stringify({ valor: valor, exp: exp })); } catch (e) { /* sin almacenamiento */ }
    window.Sesion._token = valor;
    esperandoToken.splice(0).forEach(function (r) { r(valor); });
  }

  var Sesion = {
    _token: null,
    token: function () {
      if (CFG.DEV_TOKEN) return CFG.DEV_TOKEN;
      return this._token || (this._token = leerToken());
    },
    iniciarGoogle: function (contenedorBoton) {
      if (CFG.DEV_TOKEN) return Promise.resolve();
      return new Promise(function (resolver, rechazar) {
        var intentos = 0;
        (function esperar() {
          if (window.google && google.accounts && google.accounts.id) {
            google.accounts.id.initialize({
              client_id: CFG.GOOGLE_CLIENT_ID,
              callback: function (r) { guardarToken(r.credential); },
              auto_select: true,
              use_fedcm_for_prompt: true
            });
            if (contenedorBoton) {
              google.accounts.id.renderButton(contenedorBoton, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es', width: 300 });
            }
            resolver();
          } else if (intentos++ > 100) {
            rechazar(new Error('No se pudo cargar el inicio de sesión de Google. Revisá la conexión.'));
          } else {
            setTimeout(esperar, 100);
          }
        })();
      });
    },
    /** Espera un token nuevo (lo pide a Google en silencio si se puede). */
    renovar: function () {
      var self = this;
      self._token = null;
      try { localStorage.removeItem(CLAVE); } catch (e) { /* nada */ }
      return new Promise(function (resolver) {
        esperandoToken.push(resolver);
        if (window.google && google.accounts && google.accounts.id) google.accounts.id.prompt();
      });
    },
    alRecibirToken: function () {
      return new Promise(function (resolver) { esperandoToken.push(resolver); });
    },
    cerrar: function () {
      this._token = null;
      try { localStorage.removeItem(CLAVE); } catch (e) { /* nada */ }
      if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    }
  };

  function llamar(accion, datos, token) {
    // text/plain evita el preflight CORS; Apps Script responde con redirección que fetch sigue sola
    return fetch(CFG.BACKEND_URL, {
      method: 'POST',
      body: JSON.stringify({ token: token, action: accion, data: datos || {} }),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('El servidor respondió ' + r.status);
      return r.json();
    }, function () {
      throw new Error('Sin conexión. Revisá internet y probá de nuevo.');
    });
  }

  /** Llama a una acción del backend. Si la sesión venció, la renueva y reintenta una vez. */
  function api(accion, datos) {
    var token = Sesion.token();
    var conToken = token ? Promise.resolve(token) : Sesion.renovar();
    return conToken.then(function (t) { return llamar(accion, datos, t); }).then(function (r) {
      if (r.ok) return r.data;
      if (/Sesión|sesión|Token/.test(r.error) && !CFG.DEV_TOKEN) {
        return Sesion.renovar().then(function (t) { return llamar(accion, datos, t); }).then(function (r2) {
          if (r2.ok) return r2.data;
          throw new Error(r2.error);
        });
      }
      throw new Error(r.error);
    });
  }

  window.Sesion = Sesion;
  window.api = api;
})();
