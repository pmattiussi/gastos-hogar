/**
 * Logica.gs — reglas de negocio puras.
 * No toca Sheets ni servicios de Google: recibe datos y devuelve resultados,
 * así se puede probar fuera de Apps Script.
 *
 * Convenciones:
 *  - Fechas: texto 'YYYY-MM-DD'. Períodos: texto 'YYYY-MM'.
 *  - Período de una tarjeta = mes en que VENCE el resumen.
 */
var Logica = (function () {
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  // ---------- Fechas ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function parseYMD(s) {
    var p = String(s).split('-').map(Number);
    return { y: p[0], m: p[1], d: p[2] || 1 };
  }
  function toYMD(y, m, d) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }
  function esFecha(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)); }
  function esPeriodo(s) { return /^\d{4}-\d{2}$/.test(String(s)); }
  function periodoDe(ymd) { return String(ymd).slice(0, 7); }
  function diasEnMes(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function sumarDias(ymd, n) { var p = parseYMD(ymd); return toYMD(p.y, p.m, p.d + n); }
  function sumarMeses(ymd, n) {
    var p = parseYMD(ymd);
    var idx = p.m - 1 + n;
    var y = p.y + Math.floor(idx / 12);
    var m = ((idx % 12) + 12) % 12 + 1;
    return toYMD(y, m, Math.min(p.d, diasEnMes(y, m)));
  }
  function sumarPeriodo(per, n) { return periodoDe(sumarMeses(per + '-01', n)); }
  function diaSemana(ymd) { var p = parseYMD(ymd); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
  function esFinde(ymd) { var w = diaSemana(ymd); return w === 0 || w === 6; }
  function habilSiguiente(ymd) { var x = ymd; while (esFinde(x)) x = sumarDias(x, 1); return x; }
  function habilAnterior(ymd) { var x = ymd; while (esFinde(x)) x = sumarDias(x, -1); return x; }
  function diasEntre(a, b) {
    var pa = parseYMD(a), pb = parseYMD(b);
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
  }
  function mesesEntre(perA, perB) {
    var a = parseYMD(perA + '-01'), b = parseYMD(perB + '-01');
    return (b.y - a.y) * 12 + (b.m - a.m);
  }
  function fechaCorta(ymd) { var p = parseYMD(ymd); return DIAS[diaSemana(ymd)] + ' ' + p.d + '/' + p.m; }
  function nombrePeriodo(per) { var p = parseYMD(per + '-01'); return MESES[p.m - 1] + ' ' + p.y; }

  // ---------- Montos ----------
  function redondear(n) { return Math.round(Number(n) * 100) / 100; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function verdadero(v) { return v === true || String(v).toUpperCase() === 'TRUE' || v === 1; }

  /** Divide un total en n cuotas; la última absorbe el redondeo. */
  function dividirEnCuotas(total, n) {
    var base = Math.floor(redondear(total) * 100 / n) / 100;
    var out = [];
    for (var i = 0; i < n - 1; i++) out.push(base);
    out.push(redondear(total - base * (n - 1)));
    return out;
  }

  // ---------- Calendario de tarjetas ----------
  function ciclosDeTarjeta(calendario, medioId) {
    return calendario
      .filter(function (r) { return r.medio_id === medioId && esFecha(r.fecha_cierre) && esFecha(r.fecha_vencimiento); })
      .map(function (r) {
        return { periodo: r.periodo, fecha_cierre: r.fecha_cierre, fecha_vencimiento: r.fecha_vencimiento, estimado: verdadero(r.estimado) };
      })
      .sort(function (a, b) { return a.fecha_cierre < b.fecha_cierre ? -1 : a.fecha_cierre > b.fecha_cierre ? 1 : 0; });
  }

  /** Ciclo estimado n meses después de uno conocido (cierre al hábil anterior, vencimiento al hábil siguiente). */
  function cicloProyectado(base, n) {
    return {
      periodo: sumarPeriodo(base.periodo, n),
      fecha_cierre: habilAnterior(sumarMeses(base.fecha_cierre, n)),
      fecha_vencimiento: habilSiguiente(sumarMeses(base.fecha_vencimiento, n)),
      estimado: true
    };
  }

  /** Ciclos estimados que faltan para cubrir hasta `hastaPeriodo` inclusive. */
  function ciclosFaltantes(ciclos, hastaPeriodo) {
    if (!ciclos.length) return [];
    var ult = ciclos[ciclos.length - 1];
    var out = [];
    for (var n = 1; sumarPeriodo(ult.periodo, n) <= hastaPeriodo; n++) out.push(cicloProyectado(ult, n));
    return out;
  }

  /**
   * Plan de pagos de una compra.
   * opts: { fecha, monto, cuotas, medio:{id,nombre,tipo}, calendario:[...] }
   * Débito, billetera, efectivo y transferencia se pagan en la fecha de compra.
   * Crédito: entra en el primer resumen cuyo cierre sea >= fecha de compra
   * (una compra el mismo día del cierre se toma dentro de ese resumen).
   * Cada cuota cae en el resumen siguiente al de la anterior.
   */
  function planDePagos(opts) {
    var n = Math.max(1, parseInt(opts.cuotas || 1, 10));
    var medio = opts.medio;
    if (medio.tipo !== 'credito') {
      return [{ cuota_nro: 1, cuotas_total: 1, monto: redondear(opts.monto), fecha_pago: opts.fecha,
        periodo_pago: periodoDe(opts.fecha), fecha_cierre: '', estimado: false }];
    }
    var ciclos = ciclosDeTarjeta(opts.calendario, medio.id);
    if (!ciclos.length) throw new Error('No hay fechas de cierre cargadas para ' + medio.nombre + '. Completalas en CalendarioTarjetas.');

    var idx = -1;
    for (var i = 0; i < ciclos.length; i++) { if (ciclos[i].fecha_cierre >= opts.fecha) { idx = i; break; } }
    var ult = ciclos[ciclos.length - 1];
    var saltoInicial = 0; // ciclos proyectados después del último conocido, si la compra es posterior a todos
    if (idx < 0) {
      saltoInicial = 1;
      while (cicloProyectado(ult, saltoInicial).fecha_cierre < opts.fecha) saltoInicial++;
    }

    var montos = dividirEnCuotas(opts.monto, n);
    var plan = [];
    for (var k = 0; k < n; k++) {
      var c;
      if (idx >= 0 && idx + k < ciclos.length) c = ciclos[idx + k];
      else if (idx >= 0) c = cicloProyectado(ult, idx + k - (ciclos.length - 1));
      else c = cicloProyectado(ult, saltoInicial + k);
      plan.push({ cuota_nro: k + 1, cuotas_total: n, monto: montos[k], fecha_pago: c.fecha_vencimiento,
        periodo_pago: c.periodo, fecha_cierre: c.fecha_cierre, estimado: c.estimado });
    }
    return plan;
  }

  /** Texto para mostrar al guardar: "Se paga hoy" / "Va al resumen que cierra…". */
  function describirPlan(plan, medio, hoy, simbolo) {
    simbolo = simbolo || '$';
    var p = plan[0];
    if (medio.tipo !== 'credito') {
      return {
        titulo: p.fecha_pago === hoy ? 'Se paga hoy' : 'Se paga el ' + fechaCorta(p.fecha_pago),
        detalle: 'Impacta en ' + nombrePeriodo(p.periodo_pago),
        cuando: p.periodo_pago
      };
    }
    var detalle = medio.nombre + ' · vence el ' + fechaCorta(p.fecha_pago) + (p.estimado ? ' (fecha estimada)' : '');
    if (plan.length > 1) {
      var u = plan[plan.length - 1];
      detalle += ' · ' + plan.length + ' cuotas de ' + simbolo + ' ' + formatoNumero(p.monto) +
        ', la última en ' + nombrePeriodo(u.periodo_pago);
    }
    return {
      titulo: 'Se paga en ' + MESES[parseYMD(p.periodo_pago + '-01').m - 1],
      detalle: (p.fecha_cierre >= hoy ? 'Entra en el resumen que cierra el ' : 'Resumen que cerró el ') +
        fechaCorta(p.fecha_cierre) + '. ' + detalle,
      cuando: p.periodo_pago
    };
  }

  function formatoNumero(n) {
    var neg = n < 0; n = Math.abs(redondear(n));
    var ent = Math.floor(n), dec = Math.round((n - ent) * 100);
    var s = String(ent).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + s + (dec ? ',' + pad(dec) : '');
  }

  // ---------- Dólares en tarjeta ----------
  /**
   * Reparte el costo real en pesos del saldo en USD de un resumen entre sus consumos en USD.
   * costoArs = pesos usados para cancelar dólares + dólares propios × oficial del día de pago.
   * Supone que se canceló el saldo en USD completo (lo habitual).
   */
  function ajustarUSD(movsUSD, costoArs) {
    var total = movsUSD.reduce(function (s, m) { return s + num(m.monto); }, 0);
    if (!total || !(costoArs > 0)) return { tc_efectivo: 0, total_usd: total, items: [] };
    var tc = costoArs / total, acum = 0;
    var items = movsUSD.map(function (m, i) {
      var v = i === movsUSD.length - 1 ? redondear(costoArs - acum) : redondear(num(m.monto) * tc);
      acum = redondear(acum + v);
      return { id: m.id, monto_ars_final: v };
    });
    return { tc_efectivo: redondear(tc), total_usd: redondear(total), items: items };
  }

  function montoArs(m) {
    var f = m.monto_ars_final;
    return f !== '' && f !== null && f !== undefined ? num(f) : num(m.monto_ars);
  }

  // ---------- Resumen del mes ----------
  /**
   * data: { periodo, usuarios, movimientos, ingresos, medios, categorias, aportes, cotizacionVenta }
   * Vista de caja (por fecha de pago): ingresos − pagado − tarjetas que vencen en el mes = disponible.
   * Vista de consumo (por fecha de compra): cuánto se compró en el mes.
   */
  function resumenMes(data) {
    var per = data.periodo;
    var tipoMedio = {};
    data.medios.forEach(function (m) { tipoMedio[m.id] = m.tipo; });
    var padre = {};
    data.categorias.forEach(function (c) { padre[c.id] = c.padre_id || c.id; });

    function vacio() {
      return { ingresos: 0, pagado: 0, tarjetas: 0, disponible: 0, consumo: 0, dolarizado_usd: 0,
        ahorro_generado_usd: 0, previsto: 0, ingresos_previstos: 0, disponible_proyectado: 0,
        categorias_pago: {}, categorias_consumo: {}, categorias_previsto: {}, medios: {} };
    }
    var out = { periodo: per, hogar: vacio(), personas: {} };
    data.usuarios.forEach(function (u) { out.personas[u.id] = vacio(); });
    function cuentas(persona) { return [out.hogar, out.personas[persona]].filter(Boolean); }
    function sumar(obj, k, v) { obj[k] = redondear((obj[k] || 0) + v); }

    data.ingresos.forEach(function (i) {
      if (periodoDe(i.fecha) !== per) return;
      cuentas(i.persona).forEach(function (c) { c.ingresos = redondear(c.ingresos + montoArs(i)); });
    });
    // Ingresos recurrentes del mes anterior que todavía no se cobraron este mes
    var cobrados = {};
    data.ingresos.forEach(function (i) {
      if (periodoDe(i.fecha) === per) cobrados[i.persona + '|' + i.fuente + '|' + normalizarTexto(i.descripcion)] = true;
    });
    data.ingresos.forEach(function (i) {
      if (periodoDe(i.fecha) !== sumarPeriodo(per, -1) || !verdadero(i.recurrente)) return;
      if (cobrados[i.persona + '|' + i.fuente + '|' + normalizarTexto(i.descripcion)]) return;
      cuentas(i.persona).forEach(function (c) { c.ingresos_previstos = redondear(c.ingresos_previstos + montoArs(i)); });
    });
    data.movimientos.forEach(function (m) {
      var v = montoArs(m), cat = padre[m.categoria_id] || m.categoria_id;
      if (!esReal(m)) {
        if (m.estado === 'previsto' && m.periodo_pago === per) {
          cuentas(m.persona).forEach(function (c) { c.previsto = redondear(c.previsto + v); sumar(c.categorias_previsto, cat, v); });
        }
        return;
      }
      if (m.periodo_pago === per) {
        var credito = tipoMedio[m.medio_id] === 'credito';
        cuentas(m.persona).forEach(function (c) {
          if (credito) c.tarjetas = redondear(c.tarjetas + v); else c.pagado = redondear(c.pagado + v);
          sumar(c.categorias_pago, cat, v);
          sumar(c.medios, m.medio_id, v);
        });
      }
      if (periodoDe(m.fecha) === per) {
        cuentas(m.persona).forEach(function (c) { c.consumo = redondear(c.consumo + v); sumar(c.categorias_consumo, cat, v); });
      }
    });
    (data.aportes || []).forEach(function (a) {
      if (periodoDe(a.fecha) !== per) return;
      // un aporte compartido (persona 'hogar') solo suma al total del hogar
      cuentas(a.persona).forEach(function (c) { c.dolarizado_usd = redondear(c.dolarizado_usd + num(a.monto_usd)); });
    });
    [out.hogar].concat(Object.keys(out.personas).map(function (k) { return out.personas[k]; })).forEach(function (c) {
      c.disponible = redondear(c.ingresos - c.pagado - c.tarjetas);
      c.disponible_proyectado = redondear(c.disponible + c.ingresos_previstos - c.previsto);
      c.ahorro_generado_usd = data.cotizacionVenta > 0 ? redondear(Math.max(0, c.disponible) / data.cotizacionVenta) : 0;
    });
    return out;
  }

  // ---------- Objetivos de ahorro ----------
  /** Progreso en USD, aporte mensual necesario y estado (en camino / atrasado / cumplido / vencido). */
  function progresoObjetivo(obj, aportes, hoy) {
    var meta = num(obj.meta_usd);
    var aportado = redondear(aportes.filter(function (a) { return a.objetivo_id === obj.id; })
      .reduce(function (s, a) { return s + num(a.monto_usd); }, 0));
    var falta = Math.max(0, redondear(meta - aportado));
    var perHoy = periodoDe(hoy), perFin = periodoDe(obj.fecha_limite);
    var mesesRestantes = Math.max(0, mesesEntre(perHoy, perFin) + 1); // incluye el mes actual
    var inicio = esFecha(String(obj.creado_en).slice(0, 10)) ? String(obj.creado_en).slice(0, 10) : hoy;
    var duracion = Math.max(1, diasEntre(inicio, obj.fecha_limite));
    var transcurrido = Math.min(duracion, Math.max(0, diasEntre(inicio, hoy)));
    var esperado = redondear(meta * transcurrido / duracion);
    var estado = falta === 0 ? 'cumplido' : hoy > obj.fecha_limite ? 'vencido' : aportado + 0.005 >= esperado ? 'en_camino' : 'atrasado';
    return {
      aportado_usd: aportado, falta_usd: falta, porcentaje: meta ? Math.round(aportado / meta * 100) : 0,
      meses_restantes: mesesRestantes,
      aporte_mensual_usd: mesesRestantes ? Math.ceil(falta / mesesRestantes) : falta,
      esperado_usd: esperado, estado: estado
    };
  }

  // ---------- Gastos habituales ----------
  var ESTADOS_NO_REALES = ['previsto', 'omitido'];
  /** Un previsto u omitido todavía no es un gasto real. */
  function esReal(m) { return ESTADOS_NO_REALES.indexOf(m.estado) < 0; }
  function normalizarTexto(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }
  /** Fecha del día `dia` en un período (si el mes es más corto, el último día). */
  function fechaEnPeriodo(per, dia) {
    var p = parseYMD(per + '-01');
    return toYMD(p.y, p.m, Math.min(Math.max(1, parseInt(dia, 10) || 1), diasEnMes(p.y, p.m)));
  }
  /** Previstos que faltan: habitual activo × período sin ningún movimiento de ese habitual (real, previsto u omitido). */
  function previstosFaltantes(habituales, movimientos, periodos) {
    var hay = {};
    movimientos.forEach(function (m) { if (m.habitual_id) hay[m.habitual_id + '|' + periodoDe(m.fecha)] = true; });
    var out = [];
    habituales.filter(function (h) { return verdadero(h.activo); }).forEach(function (h) {
      periodos.forEach(function (per) {
        if (h.desde && per < periodoDe(h.desde)) return;
        if (hay[h.id + '|' + per]) return;
        out.push({ habitual: h, periodo: per, fecha: fechaEnPeriodo(per, h.dia) });
      });
    });
    return out;
  }
  /** Si el mes anterior hubo un gasto igual (misma descripción, categoría y persona) sin marcar como habitual, lo sugiere. */
  function sugerirHabitual(mov, movimientos) {
    if (mov.habitual_id || Number(mov.cuotas_total || 1) > 1) return null;
    var desc = normalizarTexto(mov.descripcion);
    var perAnt = sumarPeriodo(periodoDe(mov.fecha), -1);
    var previo = movimientos.filter(function (m) {
      return esReal(m) && !m.habitual_id && periodoDe(m.fecha) === perAnt && m.categoria_id === mov.categoria_id &&
        m.persona === mov.persona && Number(m.cuotas_total || 1) === 1 &&
        (desc ? normalizarTexto(m.descripcion) === desc : (m.medio_id === mov.medio_id && num(m.monto) === num(mov.monto)));
    })[0];
    return previo ? { movimiento_id: mov.id, mes_anterior: { fecha: previo.fecha, monto: num(previo.monto), moneda: previo.moneda } } : null;
  }

  // ---------- Cash flow ----------
  /**
   * Proyección de caja por mes (por fecha en que sale o entra la plata).
   * data: { desde:'AAAA-MM', meses, hoy, usuarios, movimientos, ingresos, habituales, medios, calendario,
   *         cotizacionVenta, saldoInicial }
   * Por mes: ingresos cobrados + estimados (recurrentes que todavía no se cobraron),
   * pagos inmediatos (débito, billetera, efectivo, transferencia), resúmenes de tarjeta
   * (compras nuevas y cuotas de compras anteriores), gastos habituales previstos, saldo y acumulado.
   */
  function flujoCaja(data) {
    var n = Math.max(1, Math.min(24, parseInt(data.meses || 6, 10)));
    var periodos = [];
    for (var i = 0; i < n; i++) periodos.push(sumarPeriodo(data.desde, i));
    var perHoy = periodoDe(data.hoy);
    var tipoMedio = {}, medioPorId = {};
    data.medios.forEach(function (m) { tipoMedio[m.id] = m.tipo; medioPorId[m.id] = m; });

    function vacio() {
      return { ingresos_cobrados: 0, ingresos_estimados: 0, pagos_inmediatos: 0, tarjetas_compras_nuevas: 0,
        tarjetas_cuotas: 0, habituales_previstos: 0, egresos: 0, saldo: 0, acumulado: 0 };
    }
    var filas = {};
    periodos.forEach(function (per) {
      filas[per] = { periodo: per, hogar: vacio(), personas: {} };
      data.usuarios.forEach(function (u) { filas[per].personas[u.id] = vacio(); });
    });
    function sumarA(per, persona, campo, v) {
      var f = filas[per];
      if (!f || !v) return;
      [f.hogar, f.personas[persona]].forEach(function (c) { if (c) c[campo] = redondear(c[campo] + v); });
    }

    // Ingresos cobrados y estimados
    var firmas = {};
    data.ingresos.forEach(function (i) {
      var per = periodoDe(i.fecha), firma = i.persona + '|' + i.fuente + '|' + normalizarTexto(i.descripcion);
      sumarA(per, i.persona, 'ingresos_cobrados', montoArs(i));
      var f = firmas[firma] = firmas[firma] || { cobrados: {}, ultimo: null };
      f.cobrados[per] = true;
      if (verdadero(i.recurrente) && (!f.ultimo || i.fecha > f.ultimo.fecha)) f.ultimo = i;
    });
    Object.keys(firmas).forEach(function (k) {
      var f = firmas[k];
      if (!f.ultimo) return;
      periodos.forEach(function (per) {
        if (per >= perHoy && per > periodoDe(f.ultimo.fecha) && !f.cobrados[per]) sumarA(per, f.ultimo.persona, 'ingresos_estimados', montoArs(f.ultimo));
      });
    });

    // Movimientos: reales y previstos
    var cubierto = {};
    data.movimientos.forEach(function (m) {
      if (m.habitual_id) cubierto[m.habitual_id + '|' + periodoDe(m.fecha)] = true;
      if (m.estado === 'omitido') return;
      var v = montoArs(m);
      if (m.estado === 'previsto') { sumarA(m.periodo_pago, m.persona, 'habituales_previstos', v); return; }
      if (tipoMedio[m.medio_id] !== 'credito') sumarA(m.periodo_pago, m.persona, 'pagos_inmediatos', v);
      else sumarA(m.periodo_pago, m.persona, Number(m.cuota_nro || 1) > 1 ? 'tarjetas_cuotas' : 'tarjetas_compras_nuevas', v);
    });

    // Habituales de meses que todavía no tienen previsto generado
    var ultimoPer = periodos[periodos.length - 1];
    (data.habituales || []).filter(function (h) { return verdadero(h.activo); }).forEach(function (h) {
      var medio = medioPorId[h.medio_id];
      if (!medio) return;
      var cot = h.moneda === 'USD' ? num(data.cotizacionVenta) : 1;
      for (var per = perHoy; per <= ultimoPer; per = sumarPeriodo(per, 1)) {
        if (h.desde && per < periodoDe(h.desde)) continue;
        if (cubierto[h.id + '|' + per]) continue;
        try {
          var p = planDePagos({ fecha: fechaEnPeriodo(per, h.dia), monto: num(h.monto) * cot, cuotas: 1, medio: medio, calendario: data.calendario })[0];
          sumarA(p.periodo_pago, h.persona, 'habituales_previstos', p.monto);
        } catch (e) { /* tarjeta sin calendario: se omite de la proyección */ }
      }
    });

    // Totales y acumulado
    var acum = { hogar: num(data.saldoInicial) };
    data.usuarios.forEach(function (u) { acum[u.id] = 0; });
    return periodos.map(function (per) {
      var f = filas[per];
      [['hogar', f.hogar]].concat(data.usuarios.map(function (u) { return [u.id, f.personas[u.id]]; })).forEach(function (x) {
        var c = x[1];
        c.egresos = redondear(c.pagos_inmediatos + c.tarjetas_compras_nuevas + c.tarjetas_cuotas + c.habituales_previstos);
        c.saldo = redondear(c.ingresos_cobrados + c.ingresos_estimados - c.egresos);
        acum[x[0]] = redondear(acum[x[0]] + c.saldo);
        c.acumulado = acum[x[0]];
      });
      f.es_pasado = per < perHoy;
      return f;
    });
  }

  return {
    MESES: MESES, pad: pad, parseYMD: parseYMD, toYMD: toYMD, esFecha: esFecha, esPeriodo: esPeriodo,
    periodoDe: periodoDe, sumarDias: sumarDias, sumarMeses: sumarMeses, sumarPeriodo: sumarPeriodo,
    habilSiguiente: habilSiguiente, habilAnterior: habilAnterior, diasEntre: diasEntre, mesesEntre: mesesEntre,
    fechaCorta: fechaCorta, nombrePeriodo: nombrePeriodo, redondear: redondear, num: num, verdadero: verdadero,
    dividirEnCuotas: dividirEnCuotas, ciclosDeTarjeta: ciclosDeTarjeta, cicloProyectado: cicloProyectado,
    ciclosFaltantes: ciclosFaltantes, planDePagos: planDePagos, describirPlan: describirPlan,
    formatoNumero: formatoNumero, ajustarUSD: ajustarUSD, montoArs: montoArs, resumenMes: resumenMes,
    flujoCaja: flujoCaja, progresoObjetivo: progresoObjetivo, esReal: esReal, normalizarTexto: normalizarTexto,
    fechaEnPeriodo: fechaEnPeriodo, previstosFaltantes: previstosFaltantes, sugerirHabitual: sugerirHabitual
  };
})();
