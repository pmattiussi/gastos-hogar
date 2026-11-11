/**
 * app.js — pantallas de Gastos del hogar.
 * Sin frameworks: cada vista arma su HTML y los botones usan data-acc="nombre" (ver ACC al final).
 */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var L = window.Logica;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Estado ----------
  var S = {
    boot: null, yo: null, hoy: null,
    vista: 'inicio', periodo: null, persona: 'hogar',
    mov: { tipo: 'gastos', persona: '', por: 'compra', texto: '' },
    idx: { medios: {}, cats: {}, usuarios: {} },
    instalar: null, cargando: 0
  };
  var F = null; // formulario abierto

  // ---------- Utilidades ----------
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dinero(n, moneda) {
    n = Number(n) || 0;
    var s = (moneda === 'USD' ? 'US$ ' : '$ ') + L.formatoNumero(Math.abs(n));
    return n < 0 ? '−' + s : s;
  }
  function mesNombre(per) { var t = L.nombrePeriodo(per); return t.charAt(0).toUpperCase() + t.slice(1); }
  function mesCorto(per) { return L.MESES[Number(per.slice(5, 7)) - 1].slice(0, 3); }
  function color(persona) { var u = S.idx.usuarios[persona]; return u ? u.color : '#9AA5B8'; }
  function nombre(persona) { return persona === 'hogar' ? 'Hogar' : (S.idx.usuarios[persona] || {}).nombre || persona; }
  function catNombre(id) { var c = S.idx.cats[id]; if (!c) return id; var p = c.padre_id && S.idx.cats[c.padre_id]; return p ? p.nombre + ' · ' + c.nombre : c.nombre; }
  function catRaiz(id) { var c = S.idx.cats[id]; return c && c.padre_id ? S.idx.cats[c.padre_id] : c; }
  function catIcono(id) { var c = catRaiz(id); return (c && c.icono) || 'dots'; }
  function medioNombre(id) { return (S.idx.medios[id] || {}).nombre || id; }
  function guardarLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* nada */ } }
  function leerLocal(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function num(v) {
    var t = String(v === undefined || v === null ? '' : v).replace(/[^\d.,-]/g, '');
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    else if (!/^-?\d+\.\d{1,2}$/.test(t)) t = t.replace(/\./g, '');
    var n = Number(t); return isFinite(n) ? n : 0;
  }
  function numInput(v) { return v === '' || v === null || v === undefined ? '' : L.formatoNumero(Number(v)); }
  /** Al salir de un campo de monto, lo muestra con separador de miles. */
  function formatearAlSalir(el, alCambiar) {
    el.addEventListener('blur', function () { var n = num(el.value); if (n) { el.value = L.formatoNumero(n); if (alCambiar) alCambiar(el.value); } });
  }

  // ---------- Caché local: muestra al instante lo último visto y actualiza en segundo plano ----------
  var PREF_CACHE = 'gh_c_';
  function consultar(accion, datos) {
    var k = PREF_CACHE + accion + '|' + JSON.stringify(datos || {});
    if (S.soloCache) {
      var c = leerLocal(k);
      return c !== null && c !== undefined ? Promise.resolve(c) : Promise.reject(new Error('sin-cache'));
    }
    return api(accion, datos).then(function (r) { guardarLocal(k, r); return r; });
  }
  function borrarCache() {
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf(PREF_CACHE) === 0 || k === 'gh_boot') localStorage.removeItem(k); });
    } catch (e) { /* nada */ }
  }

  function indexar() {
    S.idx = { medios: {}, cats: {}, usuarios: {} };
    S.boot.medios.forEach(function (m) { S.idx.medios[m.id] = m; });
    S.boot.categorias.forEach(function (c) { S.idx.cats[c.id] = c; });
    S.boot.usuarios.forEach(function (u) { S.idx.usuarios[u.id] = u; });
    S.yo = S.boot.yo;
    S.hoy = S.boot.hoy;
    if (!S.periodo) S.periodo = L.periodoDe(S.hoy);
  }
  function categoriasRaiz() {
    return S.boot.categorias.filter(function (c) { return !c.padre_id; }).sort(function (a, b) { return a.orden - b.orden; });
  }
  function hijas(id) {
    return S.boot.categorias.filter(function (c) { return c.padre_id === id; }).sort(function (a, b) { return a.orden - b.orden; });
  }
  function mediosDe(persona) {
    return S.boot.medios.filter(function (m) { return !m.titular || m.titular === persona; })
      .sort(function (a, b) { return a.orden - b.orden; });
  }

  // ---------- Toast y diálogos ----------
  var tToast;
  function toast(titulo, sub) {
    var t = $('toast');
    t.innerHTML = '<b>' + esc(titulo) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '');
    t.hidden = false;
    clearTimeout(tToast);
    tToast = setTimeout(function () { t.hidden = true; }, sub ? 5000 : 3000);
  }
  function errorToast(e) { toast('No se pudo completar', e && e.message ? e.message : String(e)); }

  var hojaAbierta = false, alCerrarHoja = null, ignorarPop = false;
  function abrirHoja(html, completa) {
    var h = $('hoja');
    $('toast').hidden = true;
    h.innerHTML = '<div class="hoja-in' + (completa ? ' completa' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    h.hidden = false;
    h.querySelectorAll('input[inputmode="decimal"]').forEach(function (el) { formatearAlSalir(el); });
    document.body.style.overflow = 'hidden';
    if (!hojaAbierta) { hojaAbierta = true; history.pushState({ hoja: true }, ''); }
  }
  function cerrarHoja(desdeAtras) {
    var h = $('hoja');
    if (!hojaAbierta) return;
    hojaAbierta = false;
    h.hidden = true; h.innerHTML = '';
    document.body.style.overflow = '';
    F = null;
    var cb = alCerrarHoja; alCerrarHoja = null;
    if (!desdeAtras) { ignorarPop = true; history.back(); }
    if (cb) cb();
  }
  function preguntar(titulo, texto, botones) {
    return new Promise(function (resolver) {
      abrirHoja('<div class="hoja-cab"><h2>' + esc(titulo) + '</h2></div>' +
        (texto ? '<p class="sutil" style="font-size:15px">' + esc(texto) + '</p>' : '') +
        '<div style="display:flex;flex-direction:column;gap:8px">' + botones.map(function (b, i) {
          return '<button class="btn ' + (b.estilo || '') + '" data-resp="' + i + '">' + esc(b.texto) + '</button>';
        }).join('') + '</div>');
      var respuesta = null;
      alCerrarHoja = function () { resolver(respuesta); };
      $('hoja').querySelectorAll('[data-resp]').forEach(function (el) {
        el.addEventListener('click', function () { respuesta = botones[Number(el.dataset.resp)].valor; cerrarHoja(); });
      });
    });
  }
  window.addEventListener('popstate', function () {
    if (ignorarPop) { ignorarPop = false; return; }
    if (hojaAbierta) { cerrarHoja(true); return; }
    if (['objetivos', 'habituales', 'presupuestos', 'calendario', 'flujo'].indexOf(S.vista) >= 0) {
      S.vista = S.vista === 'flujo' && S.desdeCaja ? 'caja' : 'mas'; render();
    }
  });

  // ---------- Arranque ----------
  function pantalla(html) { $('app').innerHTML = html; }

  function iniciar() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () { /* nada */ });
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.instalar = e; });
    if (!CFG.BACKEND_URL || (!CFG.GOOGLE_CLIENT_ID && !CFG.DEV_TOKEN)) {
      pantalla('<div class="login"><h1>Falta configurar la app</h1><p>Completá BACKEND_URL y GOOGLE_CLIENT_ID en js/config.js.</p></div>');
      return;
    }
    if (CFG.DEV_TOKEN || Sesion.token()) {
      Sesion.iniciarGoogle().catch(function () { /* se reintenta al renovar */ });
      cargar();
    } else {
      mostrarLogin();
    }
  }

  function mostrarLogin(mensaje) {
    pantalla('<div class="login">' +
      '<img class="marca" src="icons/icono-192.png" alt="">' +
      '<div><h1>Gastos del hogar</h1><p style="margin-top:8px">Entrá con tu cuenta de Google. Solo pueden ingresar los mails autorizados.</p></div>' +
      (mensaje ? '<p class="error-form">' + esc(mensaje) + '</p>' : '') +
      '<div id="boton-google"></div></div>');
    Sesion.iniciarGoogle($('boton-google')).then(function () {
      google.accounts.id.prompt();
      return Sesion.alRecibirToken();
    }).then(function () { cargar(); }).catch(function (e) { mostrarLogin(e.message); });
  }

  function cargar() {
    var guardado = leerLocal('gh_boot');
    if (guardado && guardado.yo) { S.boot = guardado; indexar(); render(); }
    else pantalla('<div class="arranque"><div class="spinner" aria-hidden="true"></div><p>Cargando…</p></div>');
    api('bootstrap').then(function (b) {
      var cambio = !guardado || JSON.stringify(b) !== JSON.stringify(guardado);
      S.boot = b; guardarLocal('gh_boot', b); indexar();
      if (!guardado) render();
      else if (cambio && !hojaAbierta) render(true);
    }).catch(function (e) {
      if (/no está autorizado/.test(e.message)) { borrarCache(); Sesion.cerrar(); mostrarLogin(e.message); return; }
      if (guardado) { toast('Sin conexión', 'Estás viendo los últimos datos guardados.'); return; }
      pantalla('<div class="login"><h1>No se pudo cargar</h1><p>' + esc(e.message) + '</p><button class="btn" data-acc="reintentar">Reintentar</button></div>');
    });
  }
  function recargarBoot() { return api('bootstrap').then(function (b) { S.boot = b; guardarLocal('gh_boot', b); indexar(); }); }

  // ---------- Render general ----------
  var NAV = [
    { id: 'inicio', texto: 'Inicio', icono: 'home' },
    { id: 'movimientos', texto: 'Movimientos', icono: 'list' },
    { id: 'nuevo' },
    { id: 'caja', texto: 'Caja', icono: 'wallet' },
    { id: 'mas', texto: 'Más', icono: 'grid' }
  ];
  function nav() {
    var activa = ['objetivos', 'habituales', 'presupuestos', 'calendario'].indexOf(S.vista) >= 0 ? 'mas' : S.vista === 'flujo' ? 'caja' : S.vista;
    return '<nav class="nav" aria-label="Principal"><div class="nav-in">' + NAV.map(function (n) {
      if (n.id === 'nuevo') return '<button class="mas-btn" data-acc="nuevo" aria-label="Nuevo gasto">' + icono('plus', 'stroke-width="2.25"') + '</button>';
      return '<button data-acc="ir" data-vista="' + n.id + '"' + (activa === n.id ? ' aria-current="page"' : '') + '>' + icono(n.icono) + n.texto + '</button>';
    }).join('') + '</div></nav>';
  }
  var VISTAS = {};
  var renderId = 0;
  /**
   * Pinta la vista en dos tiempos: primero con los datos guardados en el celular (instantáneo)
   * y después con los datos frescos del servidor, solo si cambiaron.
   */
  function render(mantenerScroll) {
    var id = ++renderId, vista = S.vista, v = VISTAS[vista] || VISTAS.inicio, mostrado = null;
    var y = mantenerScroll ? window.scrollY : 0;
    var previo = mantenerScroll && $('contenido') ? $('contenido').innerHTML : null;
    pantalla('<main class="pantalla" id="contenido">' + (previo || '<div class="arranque" style="min-height:50vh"><div class="spinner"></div></div>') + '</main>' + nav());
    if (previo) window.scrollTo(0, y);
    function mostrar(html) {
      if (id !== renderId || html === mostrado) return;
      var c = $('contenido'), activo = document.activeElement;
      if (mostrado && activo && c.contains(activo) && /INPUT|TEXTAREA/.test(activo.tagName)) return; // no pisar lo que se está escribiendo
      var pos = window.scrollY;
      c.innerHTML = html;
      if (mostrado || previo) window.scrollTo(0, pos);
      mostrado = html;
      if (VISTAS[vista].despues) VISTAS[vista].despues();
    }
    S.soloCache = true;
    var rapido;
    try { rapido = Promise.resolve(v()); } catch (e) { rapido = Promise.reject(e); }
    S.soloCache = false;
    rapido.then(mostrar, function () { /* sin datos guardados: se espera al servidor */ });
    var fresco;
    try { fresco = Promise.resolve(v()); } catch (e) { fresco = Promise.reject(e); }
    fresco.then(mostrar).catch(function (e) {
      if (id !== renderId) return;
      if (mostrado) { toast('No se pudo actualizar', 'Estás viendo los últimos datos guardados. ' + e.message); return; }
      $('contenido').innerHTML = '<div class="tarjeta"><h2>No se pudo cargar</h2><p class="sutil">' + esc(e.message) + '</p><button class="btn secundario" data-acc="refrescar">Reintentar</button></div>';
    });
    if (!previo) window.scrollTo(0, 0);
  }
  function refrescar() { render(true); }

  function selectorMes(titulo) {
    return '<div class="encabezado"><div class="selector-mes">' +
      '<button class="btn-icono" data-acc="mes" data-d="-1" aria-label="Mes anterior" style="margin-left:-12px">' + icono('left') + '</button>' +
      '<h1>' + esc(titulo || mesNombre(S.periodo)) + '</h1>' +
      '<button class="btn-icono" data-acc="mes" data-d="1" aria-label="Mes siguiente">' + icono('right') + '</button></div>';
  }
  function segPersonas(acc, actual, conHogar) {
    var ops = (conHogar === false ? [] : [{ id: 'hogar', t: 'Hogar' }]).concat(S.boot.usuarios.map(function (u) { return { id: u.id, t: u.nombre, c: u.color }; }));
    return '<div class="segmentado" role="group" aria-label="Vista">' + ops.map(function (o) {
      return '<button data-acc="' + acc + '" data-id="' + o.id + '" aria-pressed="' + (actual === o.id) + '">' +
        (o.c ? '<span class="punto" style="background:' + o.c + '"></span>' : '') + esc(o.t) + '</button>';
    }).join('') + '</div>';
  }

  // ---------- Inicio ----------
  VISTAS.inicio = function () {
    var per = S.periodo;
    return consultar('pantalla.inicio', { periodo: per }).catch(function (e) {
      if (!/Acción desconocida/.test(e.message)) throw e;
      return Promise.all([consultar('resumen.mes', { periodo: per }), consultar('caja.periodo', { periodo: per }), consultar('previstos.listar', { periodo: per })])
        .then(function (r) { return { resumen: r[0], caja: r[1], previstos: r[2] }; });
    }).then(function (r) {
      var res = r.resumen, caja = r.caja, prev = r.previstos;
      var p = S.persona;
      var c = p === 'hogar' ? res.hogar : res.personas[p];
      var alertas = calcularAlertas(res, caja, prev);
      var html = selectorMes() +
        '<button class="btn-icono borde" data-acc="ver-alertas" aria-label="Alertas, ' + alertas.length + '">' + icono('bell') +
        (alertas.length ? '<span class="globo">' + alertas.length + '</span>' : '') + '</button></div>';
      html += segPersonas('persona', p);
      html += panelDisponible(c);
      if (p === 'hogar') html += cuantoQueda(res);
      var prevP = prev.filter(function (m) { return p === 'hogar' || m.persona === p; });
      if (prevP.length) html += tarjetaPrevistos(prevP);
      html += tarjetaVencimientos(caja, p);
      html += tarjetaCategorias(c, p === 'hogar' ? res.presupuestos : null);
      html += '<section class="tarjeta" id="alertas"><h2>Alertas</h2>' + (alertas.length ? alertas.map(function (a) {
        return '<div class="alerta ' + a.tono + '"><span class="ico">' + icono(a.icono) + '</span><div><b>' + esc(a.titulo) + '</b><p>' + esc(a.texto) + '</p></div></div>';
      }).join('') : '<p class="vacio">Todo en orden por ahora.</p>') + '</section>';
      html += tarjetaObjetivo();
      return html;
    });
  };

  function panelDisponible(c) {
    var ing = c.ingresos || 0;
    var base = Math.max(ing, c.pagado + c.tarjetas, 1);
    var pct = function (v) { return Math.max(0, v) / base * 100; };
    var disp = c.disponible;
    var extra = [];
    if (c.previsto) extra.push('previstos ' + dinero(c.previsto));
    if (c.ingresos_previstos) extra.push('a cobrar ' + dinero(c.ingresos_previstos));
    return '<section class="panel">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><p class="etq">Disponible real</p><p class="etq num">Ingresos ' + dinero(ing) + '</p></div>' +
      '<p class="grande num' + (disp < 0 ? ' negativo' : '') + '">' + dinero(disp) + '</p>' +
      (ing || c.pagado || c.tarjetas ? '<div class="barra-apilada" aria-hidden="true">' +
        '<span style="width:' + pct(c.pagado) + '%;background:#C9D4E8"></span>' +
        '<span style="width:' + pct(c.tarjetas) + '%;background:#6F86AD"></span>' +
        '<span style="flex:1;background:var(--menta)"></span></div>' : '<p class="etq" style="margin-top:8px">Todavía no hay ingresos cargados este mes.</p>') +
      '<div class="leyenda">' +
        '<p><span class="lbl"><span class="cuadrito" style="background:#C9D4E8"></span>Pagado</span><b class="num">' + dinero(c.pagado) + '</b></p>' +
        '<p><span class="lbl"><span class="cuadrito" style="background:#6F86AD"></span>En tarjetas</span><b class="num">' + dinero(c.tarjetas) + '</b></p>' +
        '<p><span class="lbl"><span class="cuadrito" style="background:var(--menta)"></span>Consumo</span><b class="num">' + dinero(c.consumo) + '</b></p>' +
      '</div>' +
      '<div class="proyectado"><span>Proyectado a fin de mes' + (extra.length ? '<br><small>' + esc(extra.join(' · ')) + '</small>' : '') + '</span><b class="num">' + dinero(c.disponible_proyectado) + '</b></div>' +
    '</section>';
  }

  function cuantoQueda(res) {
    return '<section class="tarjeta"><h2>Cuánto le queda a cada uno a fin de mes</h2>' + S.boot.usuarios.map(function (u) {
      var c = res.personas[u.id];
      var base = (c.ingresos + c.ingresos_previstos) || 1;
      var pct = Math.max(0, Math.min(100, c.disponible_proyectado / base * 100));
      return '<div style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;align-items:center;gap:10px">' +
        '<span class="avatar" style="background:' + u.color + '">' + esc(u.nombre.charAt(0)) + '</span>' +
        '<div style="flex:1"><p style="font-weight:700;font-size:14px">' + esc(u.nombre) + '</p><p class="sutil chico num">Ingresos ' + dinero(c.ingresos + c.ingresos_previstos) + '</p></div>' +
        '<p class="num" style="font-size:18px;font-weight:800">' + dinero(c.disponible_proyectado) + '</p></div>' +
        '<div class="pista fina"><span style="width:' + pct + '%;background:' + u.color + '"></span></div></div>';
    }).join('') + '</section>';
  }

  function tarjetaPrevistos(prev) {
    var total = prev.reduce(function (s, m) { return s + L.montoArs(m); }, 0);
    return '<section class="tarjeta"><div class="tarjeta-cab"><h2>Gastos habituales del mes</h2><span class="sutil num">' + dinero(total) + '</span></div>' +
      '<div>' + prev.map(function (m) {
        var atrasado = m.fecha < S.hoy, auto = m.debito_automatico && !atrasado;
        S.previstoAuto = S.previstoAuto || {}; S.previstoAuto[m.id] = !!m.debito_automatico;
        return '<div class="previsto"><span class="ico">' + icono(catIcono(m.categoria_id)) + '</span>' +
          '<div style="flex:1;min-width:0"><p style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.descripcion || catNombre(m.categoria_id)) + '</p>' +
          '<p class="sutil chico">' + (atrasado ? '<span class="etiqueta naranja">Venció ' + esc(L.fechaCorta(m.fecha)) + '</span>' : auto ? 'Débito automático · se carga solo el ' + esc(L.fechaCorta(m.fecha)) : esc(L.fechaCorta(m.fecha))) + ' · ' + esc(medioNombre(m.medio_id)) + '</p>' +
          '<p class="num" style="font-weight:800;margin-top:2px">' + dinero(m.monto, m.moneda) + '</p></div>' +
          '<div class="acciones"><button class="btn-mini" data-acc="omitir" data-id="' + m.id + '">No va</button>' +
          '<button class="btn-mini' + (auto ? '' : ' primario') + '" data-acc="confirmar" data-id="' + m.id + '">' + (auto ? 'Ajustar' : 'Confirmar') + '</button></div></div>';
      }).join('') + '</div></section>';
  }

  function tarjetaVencimientos(caja, p) {
    var t = caja.tarjetas.filter(function (x) { return p === 'hogar' || x.titular === p; });
    var html = '<section class="tarjeta"><div class="tarjeta-cab"><h2>Tarjetas de ' + esc(mesNombre(caja.periodo).split(' ')[0].toLowerCase()) + '</h2><button class="link" data-acc="ir" data-vista="caja">Ver Caja</button></div>';
    if (!t.length) return html + '<p class="vacio">No hay resúmenes que venzan este mes.</p></section>';
    return html + '<div>' + t.slice(0, 4).map(filaTarjeta).join('') + '</div>' +
      (t.length > 4 ? '<p class="sutil chico">+ ' + (t.length - 4) + ' tarjetas más</p>' : '') + '</section>';
  }
  function filaTarjeta(t) {
    var dias = t.fecha_vencimiento ? L.diasEntre(S.hoy, t.fecha_vencimiento) : null;
    var cuando = t.pagado ? '<span class="etiqueta verde">Pagado</span>' :
      dias === null ? '' : dias < 0 ? 'venció' : dias === 0 ? 'vence hoy' : 'en ' + dias + ' días';
    return '<div class="fila"><span class="ico">' + icono('card') + '</span><div class="cuerpo">' +
      '<p class="titulo">' + esc(t.nombre) + '</p><p class="sub"><span class="punto" style="background:' + color(t.titular) + ';width:8px;height:8px"></span>' +
      esc(nombre(t.titular)) + (t.fecha_vencimiento ? ' · vence ' + esc(L.fechaCorta(t.fecha_vencimiento)) : '') + (t.estimado ? ' (estimado)' : '') + '</p></div>' +
      '<div class="monto num">' + dinero(t.total_ars) + (t.total_usd ? '<small>+ ' + dinero(t.total_usd, 'USD') + '</small>' : '') +
      (t.previsto_ars ? '<small>+ ' + dinero(t.previsto_ars) + ' previsto</small>' : '') + '<small>' + cuando + '</small></div></div>';
  }

  function tarjetaCategorias(c, presupuestos) {
    var cats = Object.keys(c.categorias_consumo || {}).map(function (id) { return { id: id, v: c.categorias_consumo[id] }; });
    if (presupuestos) Object.keys(presupuestos).forEach(function (id) { if (!cats.some(function (x) { return x.id === id; })) cats.push({ id: id, v: 0 }); });
    cats.sort(function (a, b) { return b.v - a.v; });
    var max = Math.max.apply(null, cats.map(function (x) { return x.v; }).concat([1]));
    var html = '<section class="tarjeta"><div class="tarjeta-cab"><h2>Consumo por categoría</h2><span class="sutil chico">' + (presupuestos ? 'vs. presupuesto' : 'compras del mes') + '</span></div>';
    if (!cats.length) return html + '<p class="vacio">Sin gastos este mes.</p></section>';
    return html + cats.map(function (x) {
      var p = presupuestos && presupuestos[x.id];
      var pct = p ? x.v / p.tope_ars * 100 : x.v / max * 100;
      var barra = p && pct >= 100 ? 'var(--alerta)' : p && pct >= 80 ? 'var(--alerta)' : 'var(--tinta)';
      return '<div style="display:flex;flex-direction:column;gap:6px"><div style="display:flex;justify-content:space-between;font-size:14px;gap:8px">' +
        '<span style="font-weight:700">' + esc(catNombre(x.id)) + '</span><span class="num"><b>' + dinero(x.v) + '</b>' +
        (p ? ' <span class="sutil">/ ' + L.formatoNumero(p.tope_ars) + '</span>' : '') + '</span></div>' +
        '<div class="pista"><span style="width:' + Math.min(100, pct) + '%;background:' + barra + '"></span></div></div>';
    }).join('') + '</section>';
  }

  function tarjetaObjetivo() {
    var o = (S.boot.objetivos || [])[0];
    if (!o) return '<section class="tarjeta"><div class="tarjeta-cab"><h2>Ahorro en dólares</h2><button class="link" data-acc="ir" data-vista="objetivos">Crear objetivo</button></div></section>';
    var pr = o.progreso;
    return '<section class="tarjeta"><div class="tarjeta-cab"><h2>' + esc(o.nombre) + '</h2><button class="link" data-acc="ir" data-vista="objetivos">Objetivos</button></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><p class="num" style="font-size:22px;font-weight:800">' + dinero(pr.aportado_usd, 'USD') +
      ' <span class="sutil" style="font-size:14px;font-weight:600">de ' + L.formatoNumero(o.meta_usd) + '</span></p><p style="font-weight:700;color:var(--acento)">' + pr.porcentaje + '%</p></div>' +
      '<div class="pista"><span style="width:' + Math.min(100, pr.porcentaje) + '%;background:var(--acento)"></span></div></section>';
  }

  function umbral(id, def) {
    var a = (S.boot.alertas || []).filter(function (x) { return x.id === id; })[0];
    if (a && !L.verdadero(a.activa)) return null;
    return a && a.umbral !== '' ? Number(a.umbral) : def;
  }
  function calcularAlertas(res, caja, prev) {
    var out = [], p = S.persona;
    if (S.periodo !== L.periodoDe(S.hoy)) return out;
    var u80 = umbral('presupuesto_80', 0.8), u100 = umbral('presupuesto_100', 1);
    if (p === 'hogar') Object.keys(res.presupuestos || {}).forEach(function (id) {
      var b = res.presupuestos[id], r = b.gastado_ars / b.tope_ars;
      if (u100 !== null && r >= u100) out.push({ tono: 'naranja', icono: 'warn', titulo: catNombre(id) + ' superó el presupuesto', texto: 'Van ' + dinero(b.gastado_ars) + ' de ' + dinero(b.tope_ars) + '.' });
      else if (u80 !== null && r >= u80) out.push({ tono: 'naranja', icono: 'warn', titulo: catNombre(id) + ' al ' + Math.round(r * 100) + '%', texto: 'Quedan ' + dinero(b.tope_ars - b.gastado_ars) + ' del presupuesto.' });
    });
    var dc = umbral('cierre_tarjeta', 2);
    if (dc !== null) S.boot.calendario.forEach(function (c) {
      var m = S.idx.medios[c.medio_id];
      if (!m || (p !== 'hogar' && m.titular !== p)) return;
      var d = L.diasEntre(S.hoy, c.fecha_cierre);
      if (d >= 0 && d <= dc) out.push({ tono: 'azul', icono: 'cal', titulo: m.nombre + ' de ' + nombre(m.titular) + (d === 0 ? ' cierra hoy' : d === 1 ? ' cierra mañana' : ' cierra en ' + d + ' días'),
        texto: 'Lo que compres después del ' + L.fechaCorta(c.fecha_cierre) + ' pasa al resumen siguiente.' });
    });
    var dv = umbral('vencimiento_tarjeta', 3);
    if (dv !== null) caja.tarjetas.forEach(function (t) {
      if (t.pagado || (p !== 'hogar' && t.titular !== p)) return;
      var d = L.diasEntre(S.hoy, t.fecha_vencimiento);
      if (d >= 0 && d <= dv) out.push({ tono: 'naranja', icono: 'card', titulo: t.nombre + ' de ' + nombre(t.titular) + ' vence ' + (d === 0 ? 'hoy' : 'el ' + L.fechaCorta(t.fecha_vencimiento)),
        texto: dinero(t.total_ars) + (t.total_usd ? ' + ' + dinero(t.total_usd, 'USD') : '') + '. Registrá el pago en Caja.' });
    });
    var atrasados = prev.filter(function (m) { return m.fecha < S.hoy && (p === 'hogar' || m.persona === p); });
    if (atrasados.length) out.push({ tono: 'naranja', icono: 'repeat', titulo: atrasados.length + (atrasados.length === 1 ? ' gasto habitual sin confirmar' : ' gastos habituales sin confirmar'),
      texto: 'Ya pasó la fecha: confirmalos o marcá que este mes no van.' });
    var ud = umbral('dolarizar_pendiente', 100);
    if (ud !== null && p === 'hogar') {
      var falta = res.hogar.ahorro_generado_usd - res.hogar.dolarizado_usd;
      if (falta > ud) out.push({ tono: 'azul', icono: 'dollar', titulo: 'Te falta dolarizar ' + dinero(Math.round(falta), 'USD'), texto: 'Es lo que sobra este mes al oficial vendedor, menos los dólares ya comprados.' });
    }
    if (umbral('objetivo_atrasado', 0) !== null) (S.boot.objetivos || []).forEach(function (o) {
      if (o.progreso.estado === 'atrasado' && (p === 'hogar' || o.persona === p || o.persona === 'hogar'))
        out.push({ tono: 'naranja', icono: 'target', titulo: o.nombre + ' viene atrasado', texto: 'Necesitan ' + dinero(o.progreso.aporte_mensual_usd, 'USD') + ' por mes para llegar.' });
    });
    return out;
  }

  // ---------- Movimientos ----------
  VISTAS.movimientos = function () {
    var per = S.periodo, m = S.mov;
    var desde = per + '-01', hasta = L.sumarDias(L.sumarPeriodo(per, 1) + '-01', -1);
    var cab = selectorMes() + '</div>' +
      '<div class="segmentado" role="group" aria-label="Tipo"><button data-acc="mov-tipo" data-id="gastos" aria-pressed="' + (m.tipo === 'gastos') + '">Gastos</button>' +
      '<button data-acc="mov-tipo" data-id="ingresos" aria-pressed="' + (m.tipo === 'ingresos') + '">Ingresos</button></div>';
    var chipsPersona = '<div class="chips">' + [{ id: '', t: 'Todos' }].concat(S.boot.usuarios.map(function (u) { return { id: u.id, t: u.nombre, c: u.color }; })).map(function (o) {
      return '<button class="chip" data-acc="mov-persona" data-id="' + o.id + '" aria-pressed="' + (m.persona === o.id) + '">' +
        (o.c ? '<span class="punto" style="background:' + o.c + '"></span>' : '') + esc(o.t) + '</button>';
    }).join('') + '</div>';

    if (m.tipo === 'ingresos') {
      return consultar('ingresos.listar', { periodo: per }).then(function (lista) {
        lista = lista.filter(function (i) { return !m.persona || i.persona === m.persona; }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
        var total = lista.reduce(function (s, i) { return s + L.montoArs(i); }, 0);
        return cab + chipsPersona + '<section class="tarjeta"><div class="tarjeta-cab"><h2>Ingresos del mes</h2><span class="num" style="font-weight:800">' + dinero(total) + '</span></div>' +
          (lista.length ? '<div>' + lista.map(function (i) {
            return '<button class="fila" data-acc="editar-ingreso" data-id="' + i.id + '"><span class="ico" style="background:var(--acento-suave);color:var(--acento)">' + icono('income') + '</span><div class="cuerpo">' +
              '<p class="titulo">' + esc(i.descripcion || (i.fuente.charAt(0).toUpperCase() + i.fuente.slice(1))) + '</p><p class="sub"><span class="punto" style="background:' + color(i.persona) + ';width:8px;height:8px"></span>' +
              esc(nombre(i.persona)) + ' · ' + esc(L.fechaCorta(i.fecha)) + (L.verdadero(i.recurrente) ? ' · mensual' : '') + '</p></div><div class="monto num">' + dinero(i.monto, i.moneda) + '</div></button>';
          }).join('') + '</div>' : '<p class="vacio">No hay ingresos cargados este mes.</p>') +
          '<button class="btn secundario" data-acc="copiar-recurrentes">' + icono('repeat', 'width="18" height="18"') + 'Traer ingresos mensuales del mes anterior</button>' +
          '<button class="btn" data-acc="nuevo-ingreso">' + icono('plus', 'width="18" height="18"') + 'Cargar ingreso</button></section>';
      });
    }

    return consultar('movimientos.listar', { desde: desde, hasta: hasta, por: m.por, incluirPrevistos: true }).then(function (lista) {
      var txt = L.normalizarTexto(m.texto);
      lista = lista.filter(function (x) {
        if (m.persona && x.persona !== m.persona) return false;
        if (txt && L.normalizarTexto(x.descripcion + ' ' + catNombre(x.categoria_id) + ' ' + medioNombre(x.medio_id)).indexOf(txt) < 0) return false;
        return true;
      });
      var campo = m.por === 'pago' ? 'fecha_pago' : 'fecha';
      if (m.por === 'compra') {
        var porGrupo = {};
        lista = lista.filter(function (x) {
          if (Number(x.cuotas_total) <= 1) return true;
          var g = porGrupo[x.grupo_id];
          if (!g) { porGrupo[x.grupo_id] = g = Object.assign({}, x, { _cuotas: [] }); }
          g._cuotas.push(x);
          return false;
        }).concat(Object.keys(porGrupo).map(function (k) {
          var g = porGrupo[k];
          g._cuotas.sort(function (a, b) { return a.cuota_nro - b.cuota_nro; });
          var primera = g._cuotas[0];
          g.id = primera.id; g.fecha_pago = primera.fecha_pago; g.cuota_nro = primera.cuota_nro;
          g.monto = g._cuotas.reduce(function (s, c) { return s + Number(c.monto); }, 0);
          g.monto_ars = g._cuotas.reduce(function (s, c) { return s + L.montoArs(c); }, 0); g.monto_ars_final = '';
          return g;
        })).sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });
      }
      var total = lista.filter(L.esReal).reduce(function (s, x) { return s + L.montoArs(x); }, 0);
      var grupos = {}, orden = [];
      lista.forEach(function (x) { var k = x[campo]; if (!grupos[k]) { grupos[k] = []; orden.push(k); } grupos[k].push(x); });
      var html = cab + chipsPersona +
        '<div class="segmentado chico-seg" role="group" aria-label="Ver por"><button data-acc="mov-por" data-id="compra" aria-pressed="' + (m.por === 'compra') + '">Por fecha de compra</button>' +
        '<button data-acc="mov-por" data-id="pago" aria-pressed="' + (m.por === 'pago') + '">Por fecha de pago</button></div>' +
        '<label class="sr" for="buscar">Buscar</label><input id="buscar" class="entrada" type="search" placeholder="Buscar por descripción, categoría o medio" value="' + esc(m.texto) + '">' +
        '<div class="tarjeta-cab" style="padding:0 4px"><span class="sutil">' + (m.por === 'pago' ? 'Sale de la cuenta este mes' : 'Consumido este mes') + '</span><b class="num">' + dinero(total) + '</b></div>';
      if (!lista.length) return html + '<section class="tarjeta"><p class="vacio">No hay movimientos.</p></section>';
      return html + '<section class="tarjeta" style="gap:4px">' + orden.map(function (k) {
        return '<p class="dia">' + esc(L.fechaCorta(k)) + '</p><div>' + grupos[k].map(filaMovimiento).join('') + '</div>';
      }).join('') + '</section>';
    });
  };
  VISTAS.movimientos.despues = function () {
    var b = $('buscar');
    if (!b) return;
    var t;
    b.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { S.mov.texto = b.value; render(); setTimeout(function () { var n = $('buscar'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 50); }, 350); });
  };
  function filaMovimiento(x) {
    var medio = S.idx.medios[x.medio_id] || {};
    var etiquetas = '';
    if (x.estado === 'previsto') etiquetas += '<span class="etiqueta gris">Previsto</span>';
    else if (x.estado === 'omitido') etiquetas += '<span class="etiqueta gris">No va</span>';
    else if (x._cuotas) etiquetas += '<span class="etiqueta azul">Primera ' + esc(L.fechaCorta(x.fecha_pago)) + '</span>';
    else if (x.estado === 'pendiente') etiquetas += '<span class="etiqueta azul">Vence ' + esc(L.fechaCorta(x.fecha_pago)) + '</span>';
    if (x.habitual_id) etiquetas += '<span title="Gasto habitual" style="display:inline-flex;width:14px;height:14px">' + icono('repeat', 'width="14" height="14"') + '</span>';
    return '<button class="fila" data-acc="' + (x.estado === 'previsto' ? 'confirmar' : 'editar-gasto') + '" data-id="' + x.id + '"' + (x.estado === 'omitido' ? ' style="opacity:0.55"' : '') + '>' +
      '<span class="ico">' + icono(catIcono(x.categoria_id)) + '</span><div class="cuerpo">' +
      '<p class="titulo">' + esc(x.descripcion || catNombre(x.categoria_id)) + '</p>' +
      '<p class="sub"><span class="punto" style="background:' + color(x.persona) + ';width:8px;height:8px"></span>' + esc(medio.nombre || x.medio_id) +
      (x._cuotas ? ' · ' + x.cuotas_total + ' cuotas de ' + dinero(x._cuotas[0].monto, x.moneda) : Number(x.cuotas_total) > 1 ? ' · cuota ' + x.cuota_nro + '/' + x.cuotas_total : '') + ' ' + etiquetas + '</p></div>' +
      '<div class="monto num">' + dinero(x.monto, x.moneda) + (x.moneda === 'USD' ? '<small>' + dinero(L.montoArs(x)) + '</small>' : '') + '</div></button>';
  }

  // ---------- Caja ----------
  VISTAS.caja = function () {
    return consultar('caja.periodo', { periodo: S.periodo }).then(function (c) {
      var p = S.persona;
      var t = c.tarjetas.filter(function (x) { return p === 'hogar' || x.titular === p; });
      var totalT = t.reduce(function (s, x) { return s + x.total_ars; }, 0);
      var totalU = t.reduce(function (s, x) { return s + x.total_usd; }, 0);
      var html = selectorMes() + '</div>' + segPersonas('persona', p);
      html += '<section class="panel"><p class="etq">Resúmenes de tarjeta que vencen en ' + esc(mesNombre(S.periodo).split(' ')[0].toLowerCase()) + '</p>' +
        '<p class="grande num">' + dinero(totalT) + '</p>' + (totalU ? '<p class="etq num" style="font-size:16px;color:#fff">+ ' + dinero(totalU, 'USD') + '</p>' : '') +
        (p === 'hogar' ? '<div class="proyectado"><span>Débito, billeteras y efectivo del mes</span><b class="num" style="color:#fff">' + dinero(c.pagado_inmediato_ars) + '</b></div>' : '') +
        (c.previsto_ars && p === 'hogar' ? '<div class="proyectado" style="border:0;padding-top:0;margin-top:6px"><span>Habituales previstos</span><b class="num">' + dinero(c.previsto_ars) + '</b></div>' : '') +
        '</section>';
      html += '<button class="btn secundario" data-acc="ir" data-vista="flujo">' + icono('chart', 'width="18" height="18"') + 'Ver cash flow de los próximos 6 meses</button>';
      html += '<section class="tarjeta"><h2>Por tarjeta</h2>' + (t.length ? '<div>' + t.map(function (x) {
        return filaTarjeta(x) + (x.pagado || !x.total_ars && !x.total_usd ? '' :
          '<div style="padding:0 0 10px 52px"><button class="btn-mini primario" data-acc="pagar" data-id="' + x.medio_id + '">Registrar pago</button></div>');
      }).join('') + '</div>' : '<p class="vacio">No hay resúmenes que venzan este mes.</p>') + '</section>';
      S.cajaActual = c;
      return html;
    });
  };

  // ---------- Cash flow ----------
  VISTAS.flujo = function () {
    return consultar('flujo.proyeccion', { meses: 6 }).then(function (r) {
      var p = S.persona;
      var meses = r.meses.map(function (m) { return { per: m.periodo, c: p === 'hogar' ? m.hogar : m.personas[p] }; });
      var max = Math.max.apply(null, meses.map(function (m) { return Math.max(m.c.ingresos_cobrados + m.c.ingresos_estimados, m.c.egresos); }).concat([1]));
      var colores = { inm: '#9AA5B8', nue: '#6F86AD', cuo: '#33507A', hab: '#E8743B' };
      var html = '<div class="encabezado"><button class="btn-icono" data-acc="volver" aria-label="Volver" style="margin-left:-12px">' + icono('left') + '</button><h1 style="flex:1">Cash flow</h1></div>' +
        segPersonas('persona', p) +
        '<p class="sutil">Lo que entra y sale de la cuenta cada mes, según cuándo se paga: los resúmenes de tarjeta en el mes en que vencen y las cuotas en los meses que les tocan.</p>';
      html += '<section class="tarjeta"><div class="flujo-leyenda">' +
        '<span><span class="cuadrito" style="background:var(--acento)"></span>Ingresos</span>' +
        '<span><span class="cuadrito" style="background:' + colores.inm + '"></span>Débito y efectivo</span>' +
        '<span><span class="cuadrito" style="background:' + colores.nue + '"></span>Tarjeta</span>' +
        '<span><span class="cuadrito" style="background:' + colores.cuo + '"></span>Cuotas anteriores</span>' +
        '<span><span class="cuadrito" style="background:' + colores.hab + '"></span>Habituales</span></div>' +
        '<div>' + meses.map(function (m) {
          var c = m.c, ing = c.ingresos_cobrados + c.ingresos_estimados;
          var w = function (v) { return (v / max * 100) + '%'; };
          return '<div class="flujo-mes"><div><b style="text-transform:capitalize">' + mesCorto(m.per) + '</b><p class="sutil chico">' + m.per.slice(0, 4) + '</p></div>' +
            '<div class="flujo-barras" aria-hidden="true"><span style="width:' + w(ing) + ';background:var(--acento)' + (c.ingresos_estimados && !c.ingresos_cobrados ? ';opacity:0.55' : '') + '"></span>' +
            '<div style="display:flex;gap:2px"><span style="width:' + w(c.pagos_inmediatos) + ';background:' + colores.inm + '"></span><span style="width:' + w(c.tarjetas_compras_nuevas) + ';background:' + colores.nue + '"></span>' +
            '<span style="width:' + w(c.tarjetas_cuotas) + ';background:' + colores.cuo + '"></span><span style="width:' + w(c.habituales_previstos) + ';background:' + colores.hab + '"></span></div></div>' +
            '<div class="num" style="text-align:right"><b style="color:' + (c.saldo < 0 ? 'var(--alerta)' : 'var(--acento)') + '">' + dinero(c.saldo) + '</b><p class="sutil chico">acum. ' + dinero(c.acumulado) + '</p></div></div>';
        }).join('') + '</div></section>';
      var filas = [
        ['Ingresos cobrados', 'ingresos_cobrados'], ['Ingresos estimados', 'ingresos_estimados'],
        ['Débito, billetera, efectivo', 'pagos_inmediatos', -1], ['Tarjeta: compras nuevas', 'tarjetas_compras_nuevas', -1],
        ['Tarjeta: cuotas anteriores', 'tarjetas_cuotas', -1], ['Habituales previstos', 'habituales_previstos', -1]
      ];
      html += '<section class="tarjeta"><h2>Detalle</h2><div class="desliza"><table class="tabla-flujo num"><thead><tr><th>Concepto</th>' +
        meses.map(function (m) { return '<th>' + mesCorto(m.per) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        filas.map(function (f) {
          return '<tr><td>' + f[0] + '</td>' + meses.map(function (m) { var v = m.c[f[1]]; return '<td>' + (v ? (f[2] ? '−' : '') + L.formatoNumero(Math.round(v)) : '–') + '</td>'; }).join('') + '</tr>';
        }).join('') +
        '<tr class="total"><td>Saldo del mes</td>' + meses.map(function (m) { return '<td>' + L.formatoNumero(Math.round(m.c.saldo)) + '</td>'; }).join('') + '</tr>' +
        '<tr class="total"><td>Acumulado</td>' + meses.map(function (m) { return '<td>' + L.formatoNumero(Math.round(m.c.acumulado)) + '</td>'; }).join('') + '</tr>' +
        '</tbody></table></div><p class="sutil chico">Los ingresos estimados repiten los ingresos mensuales del último mes cobrado. Los habituales usan su monto vigente.</p></section>';
      return html;
    });
  };

  // ---------- Más ----------
  VISTAS.mas = function () {
    var items = [
      ['objetivos', 'target', 'Objetivos de ahorro', 'Metas en dólares y compras de dólares'],
      ['habituales', 'repeat', 'Gastos habituales', 'Lo que se repite todos los meses'],
      ['presupuestos', 'gauge', 'Presupuestos', 'Tope mensual por categoría'],
      ['calendario', 'cal', 'Fechas de tarjetas', 'Cierre y vencimiento de cada resumen'],
      ['flujo', 'chart', 'Cash flow', 'Próximos 6 meses']
    ];
    return '<div class="encabezado"><h1>Más</h1></div><section class="tarjeta" style="gap:0">' + items.map(function (i) {
      return '<button class="fila" data-acc="ir" data-vista="' + i[0] + '"><span class="ico">' + icono(i[1]) + '</span><div class="cuerpo"><p class="titulo">' + i[2] + '</p><p class="sub">' + i[3] + '</p></div>' + icono('right', 'width="18" height="18"') + '</button>';
    }).join('') + '</section>' +
    '<section class="tarjeta" style="gap:0">' +
      (S.instalar ? '<button class="fila" data-acc="instalar"><span class="ico">' + icono('download') + '</span><div class="cuerpo"><p class="titulo">Instalar en el celular</p><p class="sub">Queda como una app más</p></div></button>' : '') +
      '<button class="fila" data-acc="salir"><span class="ico">' + icono('logout') + '</span><div class="cuerpo"><p class="titulo">Cerrar sesión</p><p class="sub">' + esc(S.yo.nombre) + ' · ' + esc(S.yo.email) + '</p></div></button>' +
    '</section><p class="sutil chico" style="text-align:center">Gastos del hogar · versión ' + esc(S.boot.version) +
    (S.boot.cotizacion ? ' · dólar oficial vendedor ' + dinero(S.boot.cotizacion.venta) : '') + '</p>';
  };

  function cabSub(titulo, extra) {
    return '<div class="encabezado"><button class="btn-icono" data-acc="volver" aria-label="Volver" style="margin-left:-12px">' + icono('left') + '</button><h1 style="flex:1">' + esc(titulo) + '</h1>' + (extra || '') + '</div>';
  }

  // ---------- Objetivos ----------
  VISTAS.objetivos = function () {
    return Promise.all([consultar('objetivos.listar'), consultar('resumen.mes', { periodo: L.periodoDe(S.hoy) })]).then(function (r) {
      var objs = r[0], res = r[1].hogar;
      S.boot.objetivos = objs;
      var falta = Math.max(0, res.ahorro_generado_usd - res.dolarizado_usd);
      var pct = res.ahorro_generado_usd ? Math.min(100, res.dolarizado_usd / res.ahorro_generado_usd * 100) : 0;
      var html = cabSub('Ahorro en dólares', '<button class="btn-mini" data-acc="nuevo-objetivo">+ Objetivo</button>');
      html += '<section class="panel" style="gap:12px"><p class="etq">' + esc(mesNombre(L.periodoDe(S.hoy))) + ' · lo que sobró vs. lo que dolarizaron</p>' +
        '<div class="dos"><div><p class="etq">Ahorro generado</p><p class="num" style="font-size:26px;font-weight:800">' + dinero(Math.round(res.ahorro_generado_usd), 'USD') + '</p>' +
        '<p class="etq chico">' + dinero(Math.max(0, res.disponible)) + ' al oficial</p></div>' +
        '<div><p class="etq">Dólares comprados</p><p class="num" style="font-size:26px;font-weight:800;color:var(--menta)">' + dinero(res.dolarizado_usd, 'USD') + '</p></div></div>' +
        '<div class="pista" style="background:var(--oscuro-2);height:10px"><span style="width:' + pct + '%;background:var(--menta)"></span></div>' +
        '<p style="font-weight:700">' + (falta > 0 ? 'Te falta dolarizar <span style="color:var(--menta)">' + dinero(Math.round(falta), 'USD') + '</span>' : 'Dolarizaron todo lo que sobró') + '</p>' +
        '<button class="btn" style="background:var(--menta);color:#0E1A2B" data-acc="comprar-dolares"' + (objs.length ? '' : ' disabled') + '>' + icono('dollar', 'width="18" height="18"') + 'Registrar compra de dólares</button></section>';
      var necesario = objs.reduce(function (s, o) { return s + (o.progreso.estado === 'cumplido' ? 0 : o.progreso.aporte_mensual_usd); }, 0);
      if (objs.length && necesario > res.ahorro_generado_usd) {
        html += '<div class="alerta naranja"><span class="ico">' + icono('warn') + '</span><div><p>Para cumplir ' + (objs.length === 1 ? 'el objetivo' : 'los ' + objs.length + ' objetivos') +
          ' necesitan <b style="display:inline">' + dinero(necesario, 'USD') + ' por mes</b>. Este mes generaron ' + dinero(Math.round(res.ahorro_generado_usd), 'USD') + '.</p></div></div>';
      }
      if (!objs.length) html += '<section class="tarjeta"><p class="vacio">Todavía no hay objetivos. Creá el primero con "+ Objetivo".</p></section>';
      var estados = { en_camino: ['verde', 'En camino'], atrasado: ['naranja', 'Atrasado'], cumplido: ['verde', 'Cumplido'], vencido: ['gris', 'Vencido'] };
      html += objs.map(function (o) {
        var pr = o.progreso, e = estados[pr.estado] || ['gris', pr.estado];
        return '<button class="tarjeta" style="text-align:left;gap:8px" data-acc="editar-objetivo" data-id="' + o.id + '">' +
          '<div class="tarjeta-cab" style="width:100%"><h2>' + esc(o.nombre) + '</h2><span class="etiqueta ' + e[0] + '">' + e[1] + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;width:100%"><p class="num" style="font-size:20px;font-weight:800">' + dinero(pr.aportado_usd, 'USD') +
          ' <span class="sutil" style="font-size:13px">de ' + L.formatoNumero(o.meta_usd) + '</span></p><p class="sutil" style="font-weight:700">' + pr.porcentaje + '%</p></div>' +
          '<div class="pista" style="width:100%"><span style="width:' + Math.min(100, pr.porcentaje) + '%;background:' + (pr.estado === 'atrasado' ? 'var(--alerta)' : 'var(--acento)') + '"></span></div>' +
          '<p class="sutil chico">' + esc(nombre(o.persona)) + ' · ' + esc(mesNombre(L.periodoDe(o.fecha_limite)).toLowerCase()) +
          (pr.estado === 'cumplido' ? '' : ' · ' + dinero(pr.aporte_mensual_usd, 'USD') + ' por mes') +
          (pr.estado === 'atrasado' ? ' · debería ir por ' + dinero(Math.round(pr.esperado_usd), 'USD') : '') + '</p></button>';
      }).join('');
      return html;
    });
  };

  // ---------- Habituales ----------
  VISTAS.habituales = function () {
    return consultar('habituales.listar').then(function (lista) {
      var total = lista.reduce(function (s, h) { return s + (h.moneda === 'USD' ? h.monto * ((S.boot.cotizacion || {}).venta || 0) : h.monto); }, 0);
      var html = cabSub('Gastos habituales', '<button class="btn-mini" data-acc="nuevo-habitual">+ Nuevo</button>');
      html += '<p class="sutil">Se cargan solos como previstos en el mes actual y el siguiente. Al confirmarlos con otro monto, ese valor queda para adelante.</p>';
      html += '<section class="tarjeta"><div class="tarjeta-cab"><h2>Gasto fijo mensual</h2><b class="num">' + dinero(total) + '</b></div>' +
        (lista.length ? '<div>' + lista.map(function (h) {
          return '<button class="fila" data-acc="editar-habitual" data-id="' + h.id + '"><span class="ico">' + icono(catIcono(h.categoria_id)) + '</span><div class="cuerpo">' +
            '<p class="titulo">' + esc(h.nombre) + '</p><p class="sub"><span class="punto" style="background:' + color(h.persona) + ';width:8px;height:8px"></span>día ' + h.dia + ' · ' + esc(medioNombre(h.medio_id)) +
            (L.verdadero(h.debito_automatico) ? ' <span class="etiqueta azul">Débito automático</span>' : '') + '</p></div><div class="monto num">' + dinero(h.monto, h.moneda) + '</div></button>';
        }).join('') + '</div>' : '<p class="vacio">Todavía no hay gastos habituales. Marcá "Repetir todos los meses" al cargar un gasto, o creá uno acá.</p>') + '</section>';
      S.habituales = lista;
      return html;
    });
  };

  // ---------- Presupuestos ----------
  VISTAS.presupuestos = function () {
    return Promise.all([consultar('presupuestos.listar'), consultar('resumen.mes', { periodo: L.periodoDe(S.hoy) })]).then(function (r) {
      var pres = r[0], consumo = r[1].hogar.categorias_consumo;
      var html = cabSub('Presupuestos') + '<p class="sutil">Tope mensual por categoría para el hogar. Se mide contra lo comprado en el mes, aunque se pague en cuotas. Dejalo vacío para no tener tope.</p>';
      html += '<section class="tarjeta" style="gap:0">' + categoriasRaiz().map(function (c) {
        var p = pres.filter(function (x) { return x.categoria_id === c.id && x.periodo === '*'; })[0];
        return '<div class="fila"><span class="ico">' + icono(c.icono) + '</span><div class="cuerpo"><p class="titulo">' + esc(c.nombre) + '</p><p class="sub num">Este mes: ' + dinero(consumo[c.id] || 0) + '</p></div>' +
          '<label class="sr" for="pres-' + c.id + '">Tope de ' + esc(c.nombre) + '</label><input id="pres-' + c.id + '" class="entrada num" style="width:130px;text-align:right" inputmode="numeric" placeholder="Sin tope" data-pres="' + c.id + '" value="' + (p ? L.formatoNumero(p.tope_ars) : '') + '"></div>';
      }).join('') + '</section>';
      return html;
    });
  };
  VISTAS.presupuestos.despues = function () {
    document.querySelectorAll('[data-pres]').forEach(function (el) {
      el.addEventListener('change', function () {
        var v = num(el.value);
        api('presupuestos.guardar', { periodo: '*', categoria_id: el.dataset.pres, tope_ars: v || 0 }).then(function () {
          el.value = v ? L.formatoNumero(v) : '';
          toast(v ? 'Presupuesto guardado' : 'Tope eliminado');
        }).catch(errorToast);
      });
    });
  };

  // ---------- Fechas de tarjetas ----------
  VISTAS.calendario = function () {
    return consultar('calendario.listar', { desde: L.periodoDe(S.hoy) }).then(function (cal) {
      var pers = [L.periodoDe(S.hoy), L.sumarPeriodo(L.periodoDe(S.hoy), 1)];
      var html = cabSub('Fechas de tarjetas') + '<p class="sutil">Con cada resumen nuevo, corregí el próximo cierre y vencimiento. Los meses siguientes se recalculan solos y las compras pasan al resumen que les toca.</p>';
      S.boot.usuarios.forEach(function (u) {
        var tarjetas = S.boot.medios.filter(function (m) { return m.tipo === 'credito' && m.titular === u.id; });
        if (!tarjetas.length) return;
        html += '<p class="dia" style="display:flex;align-items:center;gap:8px"><span class="punto" style="background:' + u.color + '"></span>' + esc(u.nombre) + '</p>';
        tarjetas.forEach(function (m) {
          html += '<section class="tarjeta" style="gap:10px"><h2>' + esc(m.nombre) + '</h2>' + pers.map(function (per) {
            var c = cal.filter(function (x) { return x.medio_id === m.id && x.periodo === per; })[0] || {};
            var k = m.id + '|' + per;
            return '<div style="display:flex;flex-direction:column;gap:6px"><p class="sutil chico" style="display:flex;gap:8px;align-items:center">Resumen de ' + esc(mesNombre(per).toLowerCase()) +
              (L.verdadero(c.estimado) ? ' <span class="etiqueta gris">Estimado</span>' : c.fecha_cierre ? ' <span class="etiqueta verde">Confirmado</span>' : '') + '</p>' +
              '<div class="dos"><div class="campo"><label for="ci-' + k + '" style="font-size:11px">Cierre</label><input id="ci-' + k + '" class="entrada" type="date" data-cal="' + k + '" data-campo="cierre" value="' + esc(c.fecha_cierre || '') + '"></div>' +
              '<div class="campo"><label for="ve-' + k + '" style="font-size:11px">Vencimiento</label><input id="ve-' + k + '" class="entrada" type="date" data-cal="' + k + '" data-campo="venc" value="' + esc(c.fecha_vencimiento || '') + '"></div></div></div>';
          }).join('') + '</section>';
        });
      });
      return html;
    });
  };
  VISTAS.calendario.despues = function () {
    document.querySelectorAll('[data-cal]').forEach(function (el) {
      el.addEventListener('change', function () {
        var k = el.dataset.cal, partes = k.split('|');
        var ci = document.querySelector('[data-cal="' + k + '"][data-campo="cierre"]').value;
        var ve = document.querySelector('[data-cal="' + k + '"][data-campo="venc"]').value;
        if (!ci || !ve) return;
        api('calendario.guardar', { medio_id: partes[0], periodo: partes[1], fecha_cierre: ci, fecha_vencimiento: ve }).then(function (r) {
          toast('Fechas guardadas', r.compras_recalculadas ? r.compras_recalculadas + ' cuotas pasaron al resumen que les corresponde.' : 'Los meses siguientes se recalcularon.');
          return recargarBoot();
        }).then(function () { render(); }).catch(errorToast);
      });
    });
  };

  // ---------- Formulario de gasto ----------
  function abrirGasto(mov) {
    var hoyP = S.yo.id;
    if (mov) {
      var raiz = catRaiz(mov.categoria_id);
      F = { tipo: 'gasto', id: mov.id, monto: numInput(mov.monto_compra || mov.monto), moneda: mov.moneda, fecha: mov.fecha, persona: mov.persona,
        cat: raiz ? raiz.id : mov.categoria_id, sub: raiz && raiz.id !== mov.categoria_id ? mov.categoria_id : '', medio: mov.medio_id,
        cuotas: Number(mov.cuotas_total) || 1, desc: mov.descripcion || '', cotizacion: mov.moneda === 'USD' ? numInput(mov.cotizacion) : '', habitual: !!mov.habitual_id, original: mov };
    } else {
      var ult = leerLocal('ultimo_medio_' + hoyP);
      F = { tipo: 'gasto', monto: '', moneda: 'ARS', fecha: S.hoy, persona: hoyP, cat: '', sub: '', medio: ult && S.idx.medios[ult] ? ult : (mediosDe(hoyP)[0] || {}).id,
        cuotas: 1, desc: '', cotizacion: '', habitual: false, auto: false };
    }
    pintarForm();
    if (!mov) setTimeout(function () { var i = $('f-monto'); if (i) i.focus(); }, 80);
  }
  function abrirIngreso(ing) {
    F = ing ? { tipo: 'ingreso', id: ing.id, monto: numInput(ing.monto), moneda: ing.moneda, fecha: ing.fecha, persona: ing.persona, fuente: ing.fuente, desc: ing.descripcion || '', recurrente: L.verdadero(ing.recurrente), cotizacion: ing.moneda === 'USD' ? numInput(ing.cotizacion) : '' }
      : { tipo: 'ingreso', monto: '', moneda: 'ARS', fecha: S.hoy, persona: S.yo.id, fuente: 'sueldo', desc: '', recurrente: true, cotizacion: '' };
    pintarForm();
  }

  function pintarForm() {
    var f = F, editando = !!f.id;
    var html = '<div class="hoja-cab"><button class="btn-icono" data-acc="cerrar" aria-label="Cerrar" style="margin-left:-10px">' + icono('close') + '</button>';
    if (!editando) {
      html += '<div class="segmentado chico-seg" role="group" aria-label="Tipo de movimiento" style="flex:1;max-width:220px">' +
        '<button data-acc="f-tipo" data-id="gasto" aria-pressed="' + (f.tipo === 'gasto') + '">Gasto</button><button data-acc="f-tipo" data-id="ingreso" aria-pressed="' + (f.tipo === 'ingreso') + '">Ingreso</button></div><span style="width:34px"></span>';
    } else {
      html += '<h2 style="flex:1">Editar ' + f.tipo + '</h2>';
    }
    html += '</div>';
    // Monto
    html += '<div class="campo"><label for="f-monto">Monto</label><div class="monto-grande"><span class="prefijo">' + (f.moneda === 'USD' ? 'US$' : '$') + '</span>' +
      '<input id="f-monto" inputmode="decimal" autocomplete="off" placeholder="0" value="' + esc(f.monto) + '">' +
      '<div class="segmentado chico-seg" role="group" aria-label="Moneda" style="flex:none"><button data-acc="f-moneda" data-id="ARS" aria-pressed="' + (f.moneda === 'ARS') + '" style="width:52px">ARS</button>' +
      '<button data-acc="f-moneda" data-id="USD" aria-pressed="' + (f.moneda === 'USD') + '" style="width:52px">USD</button></div></div>' +
      (f.moneda === 'USD' ? '<div style="display:flex;align-items:center;gap:8px"><label for="f-cot" class="sutil" style="white-space:nowrap">Dólar oficial vendedor $</label><input id="f-cot" class="entrada num" inputmode="decimal" style="max-width:140px" placeholder="' + esc(L.formatoNumero(((S.boot.cotizacion || {}).venta) || 0)) + '" value="' + esc(f.cotizacion) + '"></div>' : '') +
      '</div>';
    html += '<div class="dos"><div class="campo"><label for="f-fecha">Fecha</label><input id="f-fecha" class="entrada" type="date" value="' + esc(f.fecha) + '"></div>' +
      '<div class="campo"><label for="f-desc">Descripción</label><input id="f-desc" class="entrada" maxlength="80" placeholder="Opcional" value="' + esc(f.desc) + '"></div></div>';
    // Persona
    html += '<div class="campo"><span class="rotulo">' + (f.tipo === 'gasto' ? 'Quién pagó' : 'De quién') + '</span><div class="dos">' + S.boot.usuarios.map(function (u) {
      var on = f.persona === u.id;
      return '<button class="chip" style="justify-content:center;min-height:48px;' + (on ? 'background:' + u.color + ';border-color:' + u.color + ';color:' + (u.id === 'noelia' ? '#0E1A2B' : '#fff') : '') + '" data-acc="f-persona" data-id="' + u.id + '" aria-pressed="' + on + '">' +
        '<span class="avatar" style="width:24px;height:24px;font-size:12px;background:' + u.color + ';box-shadow:0 0 0 2px var(--superficie)">' + esc(u.nombre.charAt(0)) + '</span>' + esc(u.nombre) + '</button>';
    }).join('') + '</div></div>';

    if (f.tipo === 'ingreso') {
      html += '<div class="campo"><span class="rotulo">Fuente</span><div class="chips envolver">' + ['sueldo', 'aguinaldo', 'extra', 'otro'].map(function (x) {
        return '<button class="chip" data-acc="f-fuente" data-id="' + x + '" aria-pressed="' + (f.fuente === x) + '">' + x.charAt(0).toUpperCase() + x.slice(1) + '</button>';
      }).join('') + '</div></div>';
      html += interruptor('f-recurrente', 'Se cobra todos los meses', 'Se usa para estimar los próximos meses', f.recurrente);
    } else {
      // Categoría
      html += '<div class="campo"><span class="rotulo">Categoría</span><div class="grilla-cat">' + categoriasRaiz().map(function (c) {
        return '<button class="cat" data-acc="f-cat" data-id="' + c.id + '" aria-pressed="' + (f.cat === c.id) + '">' + icono(c.icono) + esc(c.nombre.length > 10 ? c.nombre.slice(0, 9) + '.' : c.nombre) + '</button>';
      }).join('') + '</div>';
      var subs = f.cat ? hijas(f.cat) : [];
      if (subs.length) html += '<div class="chips">' + subs.map(function (c) {
        return '<button class="chip" data-acc="f-sub" data-id="' + c.id + '" aria-pressed="' + (f.sub === c.id) + '">' + esc(c.nombre) + '</button>';
      }).join('') + '</div>';
      html += '</div>';
      // Medio
      html += '<div class="campo"><span class="rotulo">Medio de pago</span><div class="chips">' + mediosDe(f.persona).map(function (m) {
        return '<button class="chip" data-acc="f-medio" data-id="' + m.id + '" aria-pressed="' + (f.medio === m.id) + '">' + (m.tipo === 'credito' ? icono('card') : '') + esc(m.nombre) + '</button>';
      }).join('') + '</div></div>';
      var medio = S.idx.medios[f.medio];
      if (medio && medio.tipo === 'credito' && !f.habitual) {
        html += '<div class="campo"><span class="rotulo">Cuotas</span><div class="chips envolver">' + [1, 3, 6, 9, 12, 18].map(function (n) {
          return '<button class="chip" style="flex:1;justify-content:center;padding:0 8px" data-acc="f-cuotas" data-id="' + n + '" aria-pressed="' + (f.cuotas === n) + '">' + (n === 1 ? '1 pago' : n) + '</button>';
        }).join('') + '</div></div>';
      }
      if (!editando || !f.original.habitual_id) {
        if (f.cuotas === 1) {
          html += interruptor('f-habitual', 'Repetir todos los meses', 'Queda previsto para el mes que viene', f.habitual);
          if (f.habitual) html += interruptor('f-auto', 'Débito automático', 'Se confirma solo el día del pago', f.auto);
        }
      }
      html += '<div id="f-aviso"></div>';
    }
    html += '<p class="error-form" id="f-error" hidden></p>';
    html += '<button class="btn" data-acc="f-guardar" id="f-guardar">' + (editando ? 'Guardar cambios' : f.tipo === 'gasto' ? 'Guardar gasto' : 'Guardar ingreso') + '</button>';
    if (editando) html += '<button class="btn peligro" data-acc="f-borrar">' + (f.tipo === 'gasto' && f.original.habitual_id ? 'Este mes no va' : 'Borrar') + '</button>';

    var abierta = hojaAbierta;
    var scroll = abierta ? $('hoja').firstChild.scrollTop : 0;
    abrirHoja(html, true);
    if (abierta) $('hoja').firstChild.scrollTop = scroll;
    // Campos de texto: actualizan el estado sin repintar todo
    [['f-monto', 'monto'], ['f-fecha', 'fecha'], ['f-desc', 'desc'], ['f-cot', 'cotizacion']].forEach(function (x) {
      var el = $(x[0]);
      if (el) el.addEventListener('input', function () { F[x[1]] = el.value; actualizarAviso(); });
      if (el && (x[1] === 'monto' || x[1] === 'cotizacion')) formatearAlSalir(el, function (v) { F[x[1]] = v; });
    });
    ['f-recurrente', 'f-habitual', 'f-auto'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', function () {
        var k = { 'f-recurrente': 'recurrente', 'f-habitual': 'habitual', 'f-auto': 'auto' }[id];
        F[k] = el.checked;
        if (id === 'f-habitual') { F.cuotas = 1; pintarForm(); }
      });
    });
    actualizarAviso();
  }
  function interruptor(id, titulo, sub, on) {
    return '<label class="interruptor" for="' + id + '"><span><b>' + titulo + '</b><small>' + sub + '</small></span><input id="' + id + '" type="checkbox" role="switch"' + (on ? ' checked' : '') + '></label>';
  }

  function actualizarAviso() {
    var cont = $('f-aviso');
    if (!cont || !F || F.tipo !== 'gasto') return;
    var monto = num(F.monto), medio = S.idx.medios[F.medio];
    if (!(monto > 0) || !medio || !L.esFecha(F.fecha)) { cont.innerHTML = ''; return; }
    try {
      var plan = L.planDePagos({ fecha: F.fecha, monto: monto, cuotas: F.cuotas, medio: medio, calendario: S.boot.calendario });
      var d = L.describirPlan(plan, medio, S.hoy, F.moneda === 'USD' ? 'US$' : '$');
      var meses = L.mesesEntre(L.periodoDe(S.hoy), plan[0].periodo_pago);
      var tono = medio.tipo !== 'credito' ? 'hoy' : meses <= 1 ? 'proximo' : 'lejos';
      var extra = '';
      if (F.moneda === 'USD') {
        var cot = num(F.cotizacion) || ((S.boot.cotizacion || {}).venta || 0);
        extra = '<p style="font-weight:600">≈ ' + dinero(monto * cot) + ' al oficial vendedor' + (medio.tipo === 'credito' ? '. Va al saldo en dólares del resumen; el costo final se ajusta al pagarlo.' : '') + '</p>';
      }
      cont.innerHTML = '<div class="aviso ' + tono + '"><b>' + esc(d.titulo) + '</b><p>' + esc(d.detalle) + '</p>' + extra + '</div>';
    } catch (e) {
      cont.innerHTML = '<div class="aviso lejos"><b>Falta el calendario de la tarjeta</b><p>' + esc(e.message) + '</p></div>';
    }
  }

  function errorForm(msg) { var e = $('f-error'); if (e) { e.textContent = msg; e.hidden = false; } }

  function guardarForm() {
    var f = F, monto = num(f.monto);
    if (!(monto > 0)) return errorForm('Ingresá un monto mayor a cero.');
    if (!L.esFecha(f.fecha)) return errorForm('Revisá la fecha.');
    var copia = Object.assign({}, f); // para reabrir el formulario si falla
    function fallo(e) {
      F = copia; pintarForm(); errorForm(e.message + ' — Revisá y volvé a guardar.');
    }
    var datos = { fecha: f.fecha, monto: monto, moneda: f.moneda, persona: f.persona, descripcion: f.desc.trim() };
    if (f.moneda === 'USD' && num(f.cotizacion) > 0) datos.cotizacion = num(f.cotizacion);
    var p;
    if (f.tipo === 'ingreso') {
      datos.fuente = f.fuente; datos.recurrente = f.recurrente;
      cerrarHoja(); toast('Guardando…');
      p = f.id ? api('ingresos.editar', Object.assign({ id: f.id }, datos)) : api('ingresos.crear', datos);
      return p.then(function () { toast(f.id ? 'Ingreso actualizado' : 'Ingreso guardado'); refrescar(); }).catch(fallo);
    }
    if (!f.cat) return errorForm('Elegí una categoría.');
    if (!f.medio) return errorForm('Elegí el medio de pago.');
    guardarLocal('ultimo_medio_' + f.persona, f.medio);
    cerrarHoja(); toast('Guardando…');
    datos.categoria_id = f.sub || f.cat; datos.medio_id = f.medio; datos.cuotas = f.cuotas;
    if (f.id) {
      p = api('movimientos.editar', Object.assign({ id: f.id }, datos));
    } else {
      if (f.habitual) { datos.habitual = true; datos.debito_automatico = f.auto; }
      p = api('movimientos.crear', datos);
    }
    p.then(function (r) {
      var aviso = r.aviso || {};
      toast((f.id ? 'Cambios guardados. ' : 'Gasto guardado. ') + (aviso.titulo || ''), r.habitual_actualizado ? 'El monto nuevo queda para los meses siguientes.' : r.habitual ? 'Queda previsto para el mes que viene.' : aviso.detalle);
      if (r.sugerencia_habitual) {
        return preguntar('¿Es un gasto habitual?', r.sugerencia_habitual.mensaje.replace(' ¿Es un gasto habitual?', '') + ' Si lo marcás, queda previsto todos los meses.', [
          { texto: 'Sí, se repite todos los meses', valor: true },
          { texto: 'No', valor: false, estilo: 'secundario' }
        ]).then(function (si) {
          if (si) return api('habituales.desdeMovimiento', { id: r.sugerencia_habitual.movimiento_id }).then(function () { toast('Marcado como habitual', 'Queda previsto para el mes que viene.'); });
        });
      }
    }, function (e) { fallo(e); throw null; }).then(function () { refrescar(); }).catch(function (e) { if (e) errorToast(e); });
  }

  function borrarForm() {
    var f = F, esHabitual = f.tipo === 'gasto' && f.original && f.original.habitual_id;
    var cuotas = f.tipo === 'gasto' && Number(f.original.cuotas_total) > 1;
    preguntar(esHabitual ? '¿Este mes no va?' : '¿Borrar?', esHabitual ? 'El gasto habitual sigue para los meses siguientes.' : cuotas ? 'Se borran todas las cuotas de esta compra.' : 'No se puede deshacer.', [
      { texto: esHabitual ? 'Sí, este mes no va' : 'Borrar', valor: true, estilo: 'peligro' }, { texto: 'Cancelar', valor: false, estilo: 'secundario' }
    ]).then(function (si) {
      if (!si) return;
      return api(f.tipo === 'gasto' ? 'movimientos.borrar' : 'ingresos.borrar', { id: f.id }).then(function () { toast(esHabitual ? 'Listo, este mes no va' : 'Borrado'); refrescar(); });
    }).catch(errorToast);
  }

  // ---------- Confirmar previsto ----------
  function abrirConfirmar(id) {
    var per = S.periodo;
    api('movimientos.listar', { desde: L.sumarPeriodo(per, -1) + '-01', hasta: L.sumarDias(L.sumarPeriodo(per, 2) + '-01', -1), incluirPrevistos: true }).then(function (lista) {
      var m = lista.filter(function (x) { return x.id === id; })[0];
      if (!m) throw new Error('No se encontró el gasto previsto');
      // Con débito automático la fecha es la del débito: confirmarlo antes con fecha de hoy lo mandaría a otro resumen
      var fecha = !(S.previstoAuto || {})[m.id] && L.periodoDe(m.fecha) === L.periodoDe(S.hoy) && m.fecha > S.hoy ? S.hoy : m.fecha;
      abrirHoja('<div class="hoja-cab"><h2>' + esc(m.descripcion || catNombre(m.categoria_id)) + '</h2><button class="btn-icono" data-acc="cerrar" aria-label="Cerrar">' + icono('close') + '</button></div>' +
        '<p class="sutil">' + esc(medioNombre(m.medio_id)) + ' · ' + esc(nombre(m.persona)) + ' · previsto ' + esc(L.fechaCorta(m.fecha)) + '</p>' +
        '<div class="campo"><label for="c-monto">Monto pagado</label><div class="monto-grande"><span class="prefijo">' + (m.moneda === 'USD' ? 'US$' : '$') + '</span><input id="c-monto" inputmode="decimal" value="' + esc(numInput(m.monto)) + '"></div>' +
        '<p class="sutil chico">Si cambió, el monto nuevo queda para los meses siguientes.</p></div>' +
        '<div class="campo"><label for="c-fecha">Fecha de pago</label><input id="c-fecha" class="entrada" type="date" value="' + esc(fecha) + '"></div>' +
        '<p class="error-form" id="f-error" hidden></p>' +
        '<button class="btn" id="c-ok">Confirmar pago</button><button class="btn secundario" id="c-omitir">Este mes no va</button>');
      $('c-ok').addEventListener('click', function () {
        var b = $('c-ok'); b.disabled = true; b.textContent = 'Guardando…';
        api('previstos.confirmar', { id: id, monto: num($('c-monto').value), fecha: $('c-fecha').value }).then(function (r) {
          cerrarHoja(); toast('Pago confirmado', r.mensaje || (r.aviso && r.aviso.titulo)); refrescar();
        }).catch(function (e) { b.disabled = false; b.textContent = 'Confirmar pago'; errorForm(e.message); });
      });
      $('c-omitir').addEventListener('click', function () { cerrarHoja(); omitir(id); });
    }).catch(errorToast);
  }
  function omitir(id) {
    api('previstos.omitir', { id: id }).then(function () { toast('Listo, este mes no va', 'Sigue previsto para los meses siguientes.'); refrescar(); }).catch(errorToast);
  }

  // ---------- Pago de resumen ----------
  function abrirPago(medioId) {
    var t = (S.cajaActual.tarjetas || []).filter(function (x) { return x.medio_id === medioId; })[0];
    if (!t) return;
    abrirHoja('<div class="hoja-cab"><h2>Pagar ' + esc(t.nombre) + '</h2><button class="btn-icono" data-acc="cerrar" aria-label="Cerrar">' + icono('close') + '</button></div>' +
      '<p class="sutil">Resumen de ' + esc(mesNombre(S.periodo).toLowerCase()) + ' · ' + esc(nombre(t.titular)) + ' · ' + dinero(t.total_ars) + (t.total_usd ? ' + ' + dinero(t.total_usd, 'USD') : '') + '</p>' +
      '<div class="campo"><label for="p-fecha">Fecha de pago</label><input id="p-fecha" class="entrada" type="date" value="' + esc(S.hoy) + '"></div>' +
      '<div class="campo"><label for="p-ars">Pagado del saldo en pesos</label><input id="p-ars" class="entrada num" inputmode="decimal" value="' + esc(L.formatoNumero(t.total_ars)) + '"></div>' +
      (t.total_usd ? '<div class="tarjeta" style="gap:10px"><h2>Saldo en dólares: ' + dinero(t.total_usd, 'USD') + '</h2><p class="sutil chico">Completá cómo lo pagaron: con dólares propios, con pesos o una parte de cada uno.</p>' +
        '<div class="dos"><div class="campo"><label for="p-usd">Dólares propios (US$)</label><input id="p-usd" class="entrada num" inputmode="decimal" value="0"></div>' +
        '<div class="campo"><label for="p-arsusd">Pesos para los dólares</label><input id="p-arsusd" class="entrada num" inputmode="decimal" placeholder="0"></div></div></div>' : '') +
      '<p class="error-form" id="f-error" hidden></p><button class="btn" id="p-ok">Registrar pago</button>');
    $('p-ok').addEventListener('click', function () {
      var b = $('p-ok'); b.disabled = true; b.textContent = 'Guardando…';
      api('pagos.crear', { medio_id: medioId, periodo: S.periodo, fecha_pago: $('p-fecha').value, pagado_ars: num($('p-ars').value),
        usd_con_dolares: $('p-usd') ? num($('p-usd').value) : 0, ars_para_usd: $('p-arsusd') ? num($('p-arsusd').value) : 0 }).then(function (r) {
        cerrarHoja();
        toast('Pago registrado', r.consumos_usd_ajustados ? 'Costo real de los dólares: ' + dinero(r.pago.costo_ars_usd) + ' (US$ 1 = ' + dinero(r.pago.tc_efectivo) + ')' : r.movimientos_pagados + ' consumos quedaron pagados.');
        refrescar();
      }).catch(function (e) { b.disabled = false; b.textContent = 'Registrar pago'; errorForm(e.message); });
    });
  }

  // ---------- Objetivos: formularios ----------
  function abrirObjetivo(o) {
    var personas = [{ id: 'hogar', t: 'Hogar' }].concat(S.boot.usuarios.map(function (u) { return { id: u.id, t: u.nombre }; }));
    var sel = o ? o.persona : 'hogar';
    abrirHoja('<div class="hoja-cab"><h2>' + (o ? 'Editar objetivo' : 'Nuevo objetivo') + '</h2><button class="btn-icono" data-acc="cerrar" aria-label="Cerrar">' + icono('close') + '</button></div>' +
      '<div class="campo"><label for="o-nombre">Nombre</label><input id="o-nombre" class="entrada" maxlength="60" placeholder="Ej.: Vacaciones 2027" value="' + esc(o ? o.nombre : '') + '"></div>' +
      '<div class="dos"><div class="campo"><label for="o-meta">Meta (US$)</label><input id="o-meta" class="entrada num" inputmode="decimal" value="' + esc(o ? L.formatoNumero(o.meta_usd) : '') + '"></div>' +
      '<div class="campo"><label for="o-fecha">Fecha límite</label><input id="o-fecha" class="entrada" type="date" value="' + esc(o ? o.fecha_limite : '') + '"></div></div>' +
      '<div class="campo"><span class="rotulo">De quién</span><div class="chips envolver" id="o-personas">' + personas.map(function (x) {
        return '<button class="chip" data-p="' + x.id + '" aria-pressed="' + (sel === x.id) + '">' + esc(x.t) + '</button>';
      }).join('') + '</div></div><p class="error-form" id="f-error" hidden></p><button class="btn" id="o-ok">Guardar</button>' +
      (o ? '<button class="btn peligro" id="o-baja">Archivar objetivo</button>' : ''));
    $('o-personas').addEventListener('click', function (e) {
      var b = e.target.closest('[data-p]'); if (!b) return;
      sel = b.dataset.p;
      this.querySelectorAll('[data-p]').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.p === sel); });
    });
    function guardar(activo) {
      var d = { nombre: $('o-nombre').value.trim(), meta_usd: num($('o-meta').value), fecha_limite: $('o-fecha').value, persona: sel };
      if (o) { d.id = o.id; d.activo = activo; }
      api('objetivos.guardar', d).then(function () { cerrarHoja(); toast(activo === false ? 'Objetivo archivado' : 'Objetivo guardado'); refrescar(); })
        .catch(function (e) { errorForm(e.message); });
    }
    $('o-ok').addEventListener('click', function () { guardar(true); });
    if (o) $('o-baja').addEventListener('click', function () { guardar(false); });
  }
  function abrirCompraDolares() {
    var objs = S.boot.objetivos || [];
    var sel = (objs[0] || {}).id, pers = 'hogar';
    abrirHoja('<div class="hoja-cab"><h2>Compra de dólares</h2><button class="btn-icono" data-acc="cerrar" aria-label="Cerrar">' + icono('close') + '</button></div>' +
      '<div class="campo"><span class="rotulo">Para el objetivo</span><div class="chips envolver" id="d-obj">' + objs.map(function (o) {
        return '<button class="chip" data-o="' + o.id + '" aria-pressed="' + (o.id === sel) + '">' + esc(o.nombre) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="dos"><div class="campo"><label for="d-usd">Dólares comprados</label><input id="d-usd" class="entrada num" inputmode="decimal" placeholder="US$"></div>' +
      '<div class="campo"><label for="d-ars">Pesos pagados</label><input id="d-ars" class="entrada num" inputmode="decimal" placeholder="Opcional"></div></div>' +
      '<div class="campo"><label for="d-fecha">Fecha</label><input id="d-fecha" class="entrada" type="date" value="' + esc(S.hoy) + '"></div>' +
      '<div class="campo"><span class="rotulo">Quién compró</span><div class="chips envolver" id="d-pers">' + [{ id: 'hogar', t: 'Hogar' }].concat(S.boot.usuarios.map(function (u) { return { id: u.id, t: u.nombre }; })).map(function (x) {
        return '<button class="chip" data-p="' + x.id + '" aria-pressed="' + (x.id === pers) + '">' + esc(x.t) + '</button>';
      }).join('') + '</div></div><p class="error-form" id="f-error" hidden></p><button class="btn" id="d-ok">Registrar</button>');
    function grupo(idEl, attr, set) {
      $(idEl).addEventListener('click', function (e) {
        var b = e.target.closest('[data-' + attr + ']'); if (!b) return;
        set(b.dataset[attr]);
        this.querySelectorAll('[data-' + attr + ']').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
      });
    }
    grupo('d-obj', 'o', function (v) { sel = v; });
    grupo('d-pers', 'p', function (v) { pers = v; });
    $('d-ok').addEventListener('click', function () {
      api('aportes.crear', { objetivo_id: sel, fecha: $('d-fecha').value, monto_usd: num($('d-usd').value), ars_pagados: num($('d-ars').value) || '', persona: pers }).then(function (a) {
        cerrarHoja(); toast('Compra registrada', a.cotizacion_real ? 'Pagaste US$ 1 = ' + dinero(a.cotizacion_real) : ''); refrescar();
      }).catch(function (e) { errorForm(e.message); });
    });
  }

  // ---------- Habituales: formulario ----------
  function abrirHabitual(h) {
    var st = h ? { nombre: h.nombre, monto: numInput(h.monto), moneda: h.moneda, dia: h.dia, persona: h.persona, cat: (catRaiz(h.categoria_id) || {}).id, sub: catRaiz(h.categoria_id) && catRaiz(h.categoria_id).id !== h.categoria_id ? h.categoria_id : '', medio: h.medio_id, auto: L.verdadero(h.debito_automatico) }
      : { nombre: '', monto: '', moneda: 'ARS', dia: Number(S.hoy.slice(8, 10)), persona: S.yo.id, cat: '', sub: '', medio: (mediosDe(S.yo.id)[0] || {}).id, auto: false };
    function pintar() {
      var html = '<div class="hoja-cab"><h2>' + (h ? 'Editar gasto habitual' : 'Nuevo gasto habitual') + '</h2><button class="btn-icono" data-acc="cerrar" aria-label="Cerrar">' + icono('close') + '</button></div>' +
        '<div class="campo"><label for="h-nombre">Nombre</label><input id="h-nombre" class="entrada" maxlength="60" placeholder="Ej.: Arte" value="' + esc(st.nombre) + '"></div>' +
        '<div class="dos"><div class="campo"><label for="h-monto">Monto (' + st.moneda + ')</label><input id="h-monto" class="entrada num" inputmode="decimal" value="' + esc(st.monto) + '"></div>' +
        '<div class="campo"><label for="h-dia">Día del mes</label><input id="h-dia" class="entrada num" type="number" min="1" max="31" value="' + esc(st.dia) + '"></div></div>' +
        '<div class="campo"><span class="rotulo">Quién paga</span><div class="chips envolver">' + S.boot.usuarios.map(function (u) {
          return '<button class="chip" data-h="persona" data-v="' + u.id + '" aria-pressed="' + (st.persona === u.id) + '">' + esc(u.nombre) + '</button>';
        }).join('') + '</div></div>' +
        '<div class="campo"><span class="rotulo">Categoría</span><div class="grilla-cat">' + categoriasRaiz().map(function (c) {
          return '<button class="cat" data-h="cat" data-v="' + c.id + '" aria-pressed="' + (st.cat === c.id) + '">' + icono(c.icono) + esc(c.nombre.length > 10 ? c.nombre.slice(0, 9) + '.' : c.nombre) + '</button>';
        }).join('') + '</div>' + (st.cat && hijas(st.cat).length ? '<div class="chips">' + hijas(st.cat).map(function (c) {
          return '<button class="chip" data-h="sub" data-v="' + c.id + '" aria-pressed="' + (st.sub === c.id) + '">' + esc(c.nombre) + '</button>';
        }).join('') + '</div>' : '') + '</div>' +
        '<div class="campo"><span class="rotulo">Medio de pago</span><div class="chips">' + mediosDe(st.persona).map(function (m) {
          return '<button class="chip" data-h="medio" data-v="' + m.id + '" aria-pressed="' + (st.medio === m.id) + '">' + (m.tipo === 'credito' ? icono('card') : '') + esc(m.nombre) + '</button>';
        }).join('') + '</div></div>' +
        interruptor('h-auto', 'Débito automático', 'Se confirma solo el día del pago con el último monto', st.auto) +
        '<p class="error-form" id="f-error" hidden></p><button class="btn" id="h-ok">Guardar</button>' +
        (h ? '<button class="btn peligro" id="h-baja">Dar de baja</button>' : '');
      var scroll = hojaAbierta ? $('hoja').firstChild.scrollTop : 0;
      abrirHoja(html, true);
      $('hoja').firstChild.scrollTop = scroll;
      ['nombre', 'monto', 'dia'].forEach(function (k) { $('h-' + k).addEventListener('input', function (e) { st[k] = e.target.value; }); });
      $('h-auto').addEventListener('change', function (e) { st.auto = e.target.checked; });
      $('hoja').querySelectorAll('[data-h]').forEach(function (b) {
        b.addEventListener('click', function () {
          st[b.dataset.h] = b.dataset.v;
          if (b.dataset.h === 'cat') st.sub = '';
          if (b.dataset.h === 'persona' && !mediosDe(st.persona).some(function (m) { return m.id === st.medio; })) st.medio = (mediosDe(st.persona)[0] || {}).id;
          pintar();
        });
      });
      $('h-ok').addEventListener('click', function () {
        if (!st.cat) return errorForm('Elegí una categoría.');
        var d = { nombre: st.nombre, monto: num(st.monto), moneda: st.moneda, dia: Number(st.dia), persona: st.persona, categoria_id: st.sub || st.cat, medio_id: st.medio, debito_automatico: st.auto };
        if (h) d.id = h.id;
        api('habituales.guardar', d).then(function () { cerrarHoja(); toast('Gasto habitual guardado', 'Los previstos se actualizaron.'); refrescar(); }).catch(function (e) { errorForm(e.message); });
      });
      if (h) $('h-baja').addEventListener('click', function () {
        preguntar('¿Dar de baja "' + h.nombre + '"?', 'Deja de preverse y se borran sus previstos sin confirmar. Lo ya pagado queda.', [
          { texto: 'Dar de baja', valor: true, estilo: 'peligro' }, { texto: 'Cancelar', valor: false, estilo: 'secundario' }
        ]).then(function (si) {
          if (si) return api('habituales.baja', { id: h.id }).then(function () { toast('Gasto habitual dado de baja'); refrescar(); });
        }).catch(errorToast);
      });
    }
    pintar();
  }

  // ---------- Acciones ----------
  var ACC = {
    reintentar: cargar,
    refrescar: refrescar,
    ir: function (d) { S.desdeCaja = S.vista === 'caja'; if (['objetivos', 'habituales', 'presupuestos', 'calendario', 'flujo'].indexOf(d.vista) >= 0) history.pushState({ sub: d.vista }, ''); S.vista = d.vista; render(); },
    volver: function () { history.back(); },
    mes: function (d) { S.periodo = L.sumarPeriodo(S.periodo, Number(d.d)); render(); },
    persona: function (d) { S.persona = d.id; render(); },
    'ver-alertas': function () { var a = $('alertas'); if (a) a.scrollIntoView({ behavior: 'smooth' }); },
    'mov-tipo': function (d) { S.mov.tipo = d.id; render(); },
    'mov-persona': function (d) { S.mov.persona = d.id; render(); },
    'mov-por': function (d) { S.mov.por = d.id; render(); },
    nuevo: function () { abrirGasto(); },
    'nuevo-ingreso': function () { abrirIngreso(); },
    'editar-gasto': function (d) {
      var per = S.periodo;
      api('movimientos.listar', { desde: L.sumarPeriodo(per, -24) + '-01', hasta: L.sumarPeriodo(per, 24) + '-28', por: S.mov.por }).then(function (lista) {
        var m = lista.filter(function (x) { return x.id === d.id; })[0];
        if (m) abrirGasto(m);
      }).catch(errorToast);
    },
    'editar-ingreso': function (d) {
      api('ingresos.listar', { periodo: S.periodo }).then(function (lista) {
        var i = lista.filter(function (x) { return x.id === d.id; })[0];
        if (i) abrirIngreso(i);
      }).catch(errorToast);
    },
    'copiar-recurrentes': function () {
      api('ingresos.copiarRecurrentes', { periodo: S.periodo }).then(function (r) {
        toast(r.copiados ? r.copiados + ' ingresos copiados' : 'No había ingresos mensuales para copiar', r.copiados ? 'Revisá los montos por si cambiaron.' : 'Marcá "Se cobra todos los meses" al cargar un ingreso.');
        refrescar();
      }).catch(errorToast);
    },
    confirmar: function (d) { abrirConfirmar(d.id); },
    omitir: function (d) { omitir(d.id); },
    pagar: function (d) { abrirPago(d.id); },
    cerrar: function () { cerrarHoja(); },
    'f-tipo': function (d) { if (d.id === 'ingreso') abrirIngreso(); else abrirGasto(); },
    'f-moneda': function (d) { F.moneda = d.id; pintarForm(); },
    'f-persona': function (d) {
      F.persona = d.id;
      if (F.tipo === 'gasto' && !mediosDe(F.persona).some(function (m) { return m.id === F.medio; })) {
        var ult = leerLocal('ultimo_medio_' + F.persona);
        F.medio = ult && mediosDe(F.persona).some(function (m) { return m.id === ult; }) ? ult : (mediosDe(F.persona)[0] || {}).id;
      }
      pintarForm();
    },
    'f-cat': function (d) { F.cat = d.id; F.sub = ''; pintarForm(); },
    'f-sub': function (d) { F.sub = F.sub === d.id ? '' : d.id; pintarForm(); },
    'f-medio': function (d) { F.medio = d.id; if ((S.idx.medios[d.id] || {}).tipo !== 'credito') F.cuotas = 1; pintarForm(); },
    'f-cuotas': function (d) { F.cuotas = Number(d.id); if (F.cuotas > 1) F.habitual = false; pintarForm(); },
    'f-fuente': function (d) { F.fuente = d.id; pintarForm(); },
    'f-guardar': guardarForm,
    'f-borrar': borrarForm,
    'nuevo-objetivo': function () { abrirObjetivo(); },
    'editar-objetivo': function (d) { abrirObjetivo((S.boot.objetivos || []).filter(function (o) { return o.id === d.id; })[0]); },
    'comprar-dolares': abrirCompraDolares,
    'nuevo-habitual': function () { abrirHabitual(); },
    'editar-habitual': function (d) { abrirHabitual((S.habituales || []).filter(function (h) { return h.id === d.id; })[0]); },
    instalar: function () { if (S.instalar) { S.instalar.prompt(); S.instalar = null; } },
    salir: function () { borrarCache(); Sesion.cerrar(); S.boot = null; mostrarLogin(); }
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-acc]');
    if (!el || el.disabled) return;
    var fn = ACC[el.dataset.acc];
    if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });

  iniciar();
})();
