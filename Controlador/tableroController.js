import * as Usuario from '../Modelo/usuarioModel.js';
import * as Tablero from '../Modelo/tableroModel.js';
import * as Elemento from '../Modelo/elementoModel.js';
import * as Historial from './historial.js';

// Aplica y guarda valores de un elemento (posición, tamaño, color...). Se usa al deshacer y al rehacer.
// Se busca el elemento por id en el momento de ejecutar, no se guarda el objeto.
async function aplicarElemento(id, valores) {
  const el = estado.elementos.get(id);
  if (!el) throw new Error('El elemento ya no existe');
  const r = await guardar(Elemento.actualizarElemento(id, valores));
  if (!r.ok) throw r.error;
  Object.assign(el, valores);
  const nodo = estado.nodos.get(id);
  aplicarGeometria(nodo, el);
  nodo.dataset.color = COLORES.includes(el.color) ? el.color : 'gris';
  dibujarFlechas();
  posicionarBarra();
}

async function deshacerUI() {
  try {
    const a = await Historial.deshacerUltimo();
    if (a) mostrarMensaje(`Deshecho: ${a.nombre}`);
  } catch (err) { mostrarMensaje('No se pudo deshacer: ' + err.message, true, 5000); }
}

async function rehacerUI() {
  try {
    const a = await Historial.rehacerUltimo();
    if (a) mostrarMensaje(`Rehecho: ${a.nombre}`);
  } catch (err) { mostrarMensaje('No se pudo rehacer: ' + err.message, true, 5000); }
}
const $ = (sel) => document.querySelector(sel);
const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORES = ['gris', 'amarillo', 'azul', 'verde', 'rosa', 'rojo'];
const COLOR_HEX = /^#[0-9a-f]{6}$/i;
const COLOR_BASE = '#9aa0ab';
const ESTILOS = ['solida', 'punteada', 'discontinua'];
const CURVAS = ['curva', 'recta'];
const GROSORES = [1, 2, 3, 4, 6];
const DIRECCIONES = {
  destino: { punta_origen: 'ninguna', punta_destino: 'flecha' },
  origen:  { punta_origen: 'flecha',  punta_destino: 'ninguna' },
  ambas:   { punta_origen: 'flecha',  punta_destino: 'flecha' },
  ninguna: { punta_origen: 'ninguna', punta_destino: 'ninguna' },
};
const CLASE_TIPO = { nota: 'nota', lista_tareas: 'lista', enlace: 'enlace', imagen: 'imagen' };
const DEFECTOS = {
  nota:         { ancho: 220, alto: null, color: 'amarillo' },
  lista_tareas: { ancho: 240, alto: null, color: 'gris' },
  enlace:       { ancho: 220, alto: null, color: 'gris' },
  imagen:       { ancho: 240, alto: 180,  color: 'gris' },
};
const AVISOS = {
  nota: 'Haz clic en el lienzo para colocar la nota',
  lista_tareas: 'Haz clic en el lienzo para colocar la lista',
  enlace: 'Haz clic en el lienzo para colocar el enlace',
  imagen: 'Haz clic en el lienzo para colocar la imagen',
  linea: 'Haz clic en el elemento de origen',
};
const CONFIG_CAMPO = {
  nota:         { multilinea: true,  max: 10000, vacioPermitido: true },
  lista_tareas: { multilinea: false, max: 200 },
  enlace:       { multilinea: false, max: 200 },
};
const ANCHO_MIN = 120;
const ALTO_MIN = 40;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_PASO = 0.1;

const estado = {
  flechaSeleccionada: null,  
  puntoFlecha: null,       
  tableroId: null,
  tablero: null,
  soloLectura: false,
  elementos: new Map(),      // id -> elemento
  nodos: new Map(),          // id -> <article>
  conexiones: new Map(),     // id -> conexión
  herramienta: null,
  seleccionado: null,
  origenLinea: null,
  pendiente: null,           // { tipo, x, y } mientras el modal está abierto
  huboArrastre: false,
  zoom: 1,
};

let modalRecurso = null;

iniciar().catch((err) => {
  console.error(err);
  mostrarMensaje(err.message, true);
});

// =====================================================================
// Arranque
// =====================================================================
async function iniciar() {
  const sesion = await Usuario.sesionActual();
  if (!sesion) { location.href = 'inicioseccion.html'; return; }

  const id = Number(new URLSearchParams(location.search).get('id'));
  if (!Number.isInteger(id) || id <= 0) { location.href = 'contenido.html#tableros'; return; }
  estado.tableroId = id;

  const perfil = await Usuario.obtenerPerfil(sesion.user.id);
  $('#nombre-usuario').textContent = perfil.nombre_usuario;

  try {
    estado.tablero = await Tablero.obtenerTablero(id);   // si no tienes acceso, la base de datos no lo devuelve
  } catch {
    mostrarMensaje('Este tablero no existe o no tienes acceso a él', true, 5000);
    setTimeout(() => { location.href = 'contenido.html#tableros'; }, 2500);
    return;
  }

  estado.soloLectura = !(await Tablero.puedoEditar(id));
  const puedeRenombrar = estado.tablero.propietario_id === sesion.user.id || perfil.rol === 'Usuario';

  const nombre = $('#tablero-nombre');
  nombre.value = estado.tablero.nombre;
  nombre.readOnly = !puedeRenombrar;
  document.title = `${estado.tablero.nombre} – Dario Pex`;

  if (estado.soloLectura) {
    document.querySelectorAll('.herramienta').forEach((b) => { b.disabled = true; });
    mostrarMensaje('Este tablero es de solo lectura para ti', false, 5000);
  }

  modalRecurso = window.bootstrap?.Modal.getOrCreateInstance($('#modal-recurso')) ?? null;
  conectarEventos();
  await cargarContenido();
}

async function cargarContenido() {
  const [elementos, conexiones] = await Promise.all([
    Elemento.cargarElementos(estado.tableroId),
    Elemento.cargarConexiones(estado.tableroId),
  ]);

  estado.elementos.clear();
  estado.nodos.clear();
  estado.conexiones.clear();
  $('#capa-elementos').replaceChildren();

  for (const el of elementos) {
    estado.elementos.set(el.id, el);
    const nodo = crearNodo(el);
    estado.nodos.set(el.id, nodo);
    $('#capa-elementos').appendChild(nodo);
  }
  for (const c of conexiones) estado.conexiones.set(c.id, c);

  dibujarFlechas();
  actualizarVacio();
}

// =====================================================================
// Mensajes y guardado
// =====================================================================
let temporizadorMensaje = null;

function mostrarMensaje(texto, esError = false, ms = 3500) {
  const m = $('#mensaje');
  if (!m) return;
  m.textContent = texto;
  m.style.color = esError ? '#ff7b72' : '';
  clearTimeout(temporizadorMensaje);
  if (texto) temporizadorMensaje = setTimeout(() => { m.textContent = ''; }, ms);
}

function marcarGuardado(texto, esError = false) {
  const e = $('#estado-guardado');
  e.textContent = texto;
  e.classList.toggle('error', esError);
}

let pendientes = 0;
let huboError = false;

// Ejecuta un guardado y muestra el estado. Nunca lanza error: devuelve { ok, datos } o { ok:false, error }.
async function guardar(promesa) {
  if (pendientes === 0) huboError = false;
  pendientes++;
  marcarGuardado('Guardando...');
  try {
    return { ok: true, datos: await promesa };
  } catch (err) {
    huboError = true;
    console.error(err);
    mostrarMensaje(err.message, true, 5000);
    return { ok: false, error: err };
  } finally {
    pendientes--;
    if (pendientes === 0) {
      if (huboError) marcarGuardado('Error al guardar', true);
      else marcarGuardado('Todo guardado');
    }
  }
}

// =====================================================================
// Elementos en pantalla
// =====================================================================
function aplicarGeometria(nodo, el) {
  nodo.style.left = `${el.pos_x}px`;
  nodo.style.top = `${el.pos_y}px`;
  nodo.style.width = `${el.ancho ?? DEFECTOS[el.tipo].ancho}px`;
  nodo.style.zIndex = el.z_index ?? 0;
  if (el.tipo === 'imagen') nodo.style.height = `${el.alto ?? DEFECTOS.imagen.alto}px`;
  else if (el.alto) nodo.style.minHeight = `${el.alto}px`;
}

function crearNodo(el) {
  const nodo = document.createElement('article');
  nodo.className = `elemento ${CLASE_TIPO[el.tipo] ?? ''}`;
  nodo.dataset.id = el.id;
  nodo.dataset.tipo = el.tipo;
  nodo.dataset.color = COLORES.includes(el.color) ? el.color : 'gris';
  nodo.tabIndex = 0;
  aplicarGeometria(nodo, el);

  if (el.tipo === 'nota') {
    const texto = document.createElement('div');
    texto.className = 'elemento-contenido';
    texto.dataset.campo = 'texto';
    texto.setAttribute('role', 'textbox');
    texto.setAttribute('aria-multiline', 'true');
    texto.setAttribute('aria-label', 'Texto de la nota');
    texto.textContent = el.detalle.texto ?? '';       // textContent evita inyección de HTML
    nodo.appendChild(texto);

  } else if (el.tipo === 'lista_tareas') {
    const titulo = document.createElement('h3');
    titulo.className = 'lista-titulo';
    titulo.dataset.campo = 'titulo';
    titulo.textContent = el.detalle.titulo ?? 'TAREA';
    nodo.appendChild(titulo);

    const ul = document.createElement('ul');
    ul.className = 'tareas';
    el.tareas.forEach((t) => ul.appendChild(crearFilaTarea(t, el)));
    nodo.appendChild(ul);

    const form = document.createElement('form');
    form.className = 'tarea-nueva';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 500;
    input.placeholder = '+ Añadir tarea';
    input.setAttribute('aria-label', 'Nueva tarea');
    input.disabled = estado.soloLectura;
    form.appendChild(input);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const texto = input.value.trim().slice(0, 500);
      if (!texto) return;
      const orden = el.tareas.reduce((m, t) => Math.max(m, t.orden), 0) + 1;
      input.disabled = true;
      const r = await guardar(Elemento.crearTarea(el.id, texto, orden));
      input.disabled = false;
      if (!r.ok) return;
      el.tareas.push(r.datos);
      ul.appendChild(crearFilaTarea(r.datos, el));
      input.value = '';
      input.focus();
      aplicarGeometria(nodo, el);
      dibujarFlechas();
    });
    nodo.appendChild(form);

  } else if (el.tipo === 'enlace') {
    const url = el.detalle.url ?? '';
    const vinculo = document.createElement('div');
    vinculo.className = 'enlace-vinculo';

    const titulo = document.createElement('span');
    titulo.className = 'enlace-titulo';
    titulo.dataset.campo = 'titulo';
    titulo.textContent = el.detalle.titulo || dominioDe(url);
    vinculo.appendChild(titulo);

    if (urlSegura(url)) {
      const a = document.createElement('a');
      a.className = 'enlace-dominio';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.color = 'inherit';
      a.textContent = dominioDe(url);
      vinculo.appendChild(a);
    }
    nodo.appendChild(vinculo);

  } else if (el.tipo === 'imagen') {
    const url = el.detalle.url ?? '';
    if (urlSegura(url)) {
      const img = document.createElement('img');
      img.className = 'imagen-foto';
      img.src = url;
      img.alt = 'Imagen del tablero';
      img.draggable = false;
      img.addEventListener('load', () => { dibujarFlechas(); });
      nodo.appendChild(img);
    }
  }

  if (el.tipo !== 'enlace') {
    const asa = document.createElement('span');
    asa.className = 'redimensionar';
    asa.setAttribute('aria-hidden', 'true');
    nodo.appendChild(asa);
  }
  return nodo;
}

function crearFilaTarea(t, el) {
  const li = document.createElement('li');
  li.className = 'tarea';

  const casilla = document.createElement('input');
  casilla.type = 'checkbox';
  casilla.className = 'tarea-casilla';
  casilla.checked = !!t.completada;
  casilla.disabled = estado.soloLectura;
  casilla.setAttribute('aria-label', 'Completada');
  casilla.addEventListener('change', async () => {
    const r = await guardar(Elemento.actualizarTarea(t.id, { completada: casilla.checked }));
    if (r.ok) t.completada = casilla.checked;
    else casilla.checked = !casilla.checked;
  });

  const texto = document.createElement('span');
  texto.className = 'tarea-texto';
  texto.textContent = t.texto;
  texto.addEventListener('dblclick', () => {
    if (estado.soloLectura || estado.herramienta) return;
    editarCampo(texto, { multilinea: false, max: 500 }, async (nuevo) => {
      const r = await guardar(Elemento.actualizarTarea(t.id, { texto: nuevo }));
      if (r.ok) t.texto = nuevo;
      return r.ok;
    });
  });

  const borrar = document.createElement('button');
  borrar.type = 'button';
  borrar.className = 'tarea-borrar';
  borrar.setAttribute('aria-label', 'Eliminar tarea');
  borrar.textContent = '×';
  borrar.disabled = estado.soloLectura;
  borrar.addEventListener('click', async () => {
    const r = await guardar(Elemento.eliminarTarea(t.id));
    if (!r.ok) return;
    el.tareas = el.tareas.filter((x) => x.id !== t.id);
    li.remove();
    dibujarFlechas();
  });

  li.append(casilla, texto, borrar);
    if (!estado.soloLectura) {
    const asa = document.createElement('button');
    asa.type = 'button';
    asa.className = 'tarea-asa';
    asa.setAttribute('aria-label', 'Mover tarea (arrastra, o usa las flechas arriba y abajo)');
    asa.textContent = '⋮⋮';
    activarOrdenTarea(li, asa);
    li.prepend(asa);
  }
  return li;
}

// Reordenar tareas dentro de una lista (solo visual: no se guarda en la base de datos)
function activarOrdenTarea(li, asa) {
  asa.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();                 // evita que se arrastre el elemento entero
    li.classList.add('moviendo');

    const mover = (ev) => {
      const ul = li.parentElement;
      // La primera tarea cuyo centro queda por debajo del puntero marca el nuevo lugar
      const siguiente = [...ul.children].find((x) => {
        if (x === li) return false;
        const r = x.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (siguiente) {
        if (li.nextElementSibling !== siguiente) ul.insertBefore(li, siguiente);
      } else if (ul.lastElementChild !== li) {
        ul.appendChild(li);
      }
    };

    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      li.classList.remove('moviendo');
    };

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  });

  // Con teclado: enfoca el asa y usa las flechas arriba y abajo
  asa.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    const ul = li.parentElement;
    if (e.key === 'ArrowUp' && li.previousElementSibling) ul.insertBefore(li, li.previousElementSibling);
    if (e.key === 'ArrowDown' && li.nextElementSibling) ul.insertBefore(li.nextElementSibling, li);
    asa.focus();
  });
}

function actualizarVacio() {
  $('#estado-vacio').hidden = estado.elementos.size > 0;
}

// =====================================================================
// Selección y barra del elemento
// =====================================================================
function quitarSeleccionElemento() {
  if (estado.seleccionado) estado.nodos.get(estado.seleccionado)?.classList.remove('seleccionado');
  estado.seleccionado = null;
  posicionarBarra();
}

function seleccionar(id) {
  quitarSeleccionFlecha();                              // solo una cosa seleccionada a la vez
  if (estado.seleccionado) estado.nodos.get(estado.seleccionado)?.classList.remove('seleccionado');
  estado.seleccionado = id;
  estado.nodos.get(id)?.classList.add('seleccionado');
  marcarColorActivo();
  posicionarBarra();
}

function deseleccionar() {
  quitarSeleccionElemento();
  quitarSeleccionFlecha();
}

function reposicionarBarras() {
  posicionarBarra();
  posicionarBarraFlecha();
}

function marcarColorActivo() {
  const el = estado.elementos.get(estado.seleccionado);
  document.querySelectorAll('#barra-elemento .color').forEach((b) => {
    b.classList.toggle('activo', !!el && b.dataset.color === el.color);
  });
}

function posicionarBarra() {
  const barra = $('#barra-elemento');
  const nodo = estado.seleccionado ? estado.nodos.get(estado.seleccionado) : null;
  if (!nodo || estado.soloLectura) { barra.hidden = true; return; }
  barra.hidden = false;
  const r = nodo.getBoundingClientRect();
  const arriba = r.top - barra.offsetHeight - 8;
  barra.style.top = `${arriba < 56 ? r.bottom + 8 : arriba}px`;
  barra.style.left = `${Math.min(Math.max(r.left, 80), window.innerWidth - barra.offsetWidth - 8)}px`;
}

async function cambiarColor(color) {
  const el = estado.elementos.get(estado.seleccionado);
  if (!el || !COLORES.includes(color) || el.color === color) return;
  const anterior = el.color;
  el.color = color;
  estado.nodos.get(el.id).dataset.color = color;
  marcarColorActivo();
  const r = await guardar(Elemento.actualizarElemento(el.id, { color }));
  if (!r.ok) {
    el.color = anterior;
    estado.nodos.get(el.id).dataset.color = COLORES.includes(anterior) ? anterior : 'gris';
    marcarColorActivo();
    return;
  }
  Historial.registrar({
    nombre: 'color',
    deshacer: () => aplicarElemento(el.id, { color: anterior }),
    rehacer: () => aplicarElemento(el.id, { color }),
  });
}

async function alFrente() {
  const el = estado.elementos.get(estado.seleccionado);
  if (!el) return;
  const maximo = Math.max(0, ...[...estado.elementos.values()].map((e) => e.z_index ?? 0));
  el.z_index = maximo + 1;
  estado.nodos.get(el.id).style.zIndex = el.z_index;
  await guardar(Elemento.actualizarElemento(el.id, { z_index: el.z_index }));
}

async function eliminarSeleccionado() {
  const el = estado.elementos.get(estado.seleccionado);
  if (!el || estado.soloLectura) return;
  const extra = el.tipo === 'lista_tareas' && el.tareas.length ? ' Se eliminarán también sus tareas.' : '';
  if (!confirm('¿Eliminar este elemento?' + extra)) return;

  const r = await guardar(Elemento.eliminarElemento(el));
  if (!r.ok) return;
  estado.nodos.get(el.id)?.remove();
  estado.nodos.delete(el.id);
  estado.elementos.delete(el.id);
  for (const [id, c] of estado.conexiones) {
    if (c.origen_id === el.id || c.destino_id === el.id) {
      estado.conexiones.delete(id);                      // la base de datos ya las borró
      if (estado.flechaSeleccionada === id) estado.flechaSeleccionada = null;
    }
  }
  estado.seleccionado = null;
  posicionarBarra();
  dibujarFlechas();
  actualizarVacio();
}

// =====================================================================
// Herramientas y creación
// =====================================================================
function elegirHerramienta(nombre) {
  if (estado.soloLectura) return;
  cancelarLinea();
  estado.herramienta = estado.herramienta === nombre ? null : nombre;
  document.querySelectorAll('.herramienta').forEach((b) => {
    b.classList.toggle('activa', b.dataset.herramienta === estado.herramienta);
  });
  const visor = $('#visor');
  visor.classList.toggle('modo-colocar', !!estado.herramienta && estado.herramienta !== 'linea');
  visor.classList.toggle('modo-linea', estado.herramienta === 'linea');
  if (estado.herramienta) mostrarMensaje(AVISOS[estado.herramienta], false, 4000);
}

function coordenadas(e) {
  const r = $('#lienzo').getBoundingClientRect();      // ya incluye el scroll y el zoom
  return {
    x: Math.max(0, Math.round((e.clientX - r.left) / estado.zoom)),
    y: Math.max(0, Math.round((e.clientY - r.top) / estado.zoom)),
  };
}

async function colocar(tipo, x, y) {
  if (tipo === 'enlace' || tipo === 'imagen') { abrirModalRecurso(tipo, x, y); return; }
  try {
    const el = await crearEnLienzo(tipo, x, y);
    elegirHerramienta(null);
    if (tipo === 'nota') editarContenido(el, estado.nodos.get(el.id).querySelector('[data-campo="texto"]'));
  } catch { /* guardar() ya mostró el error */ }
}

async function crearEnLienzo(tipo, x, y, datos = {}) {
  const d = DEFECTOS[tipo];
  const r = await guardar(Elemento.crearElemento(
    estado.tableroId, tipo, { x, y, ancho: d.ancho, alto: d.alto, color: d.color }, datos));
  if (!r.ok) throw r.error;

  const el = r.datos;
  estado.elementos.set(el.id, el);
  const nodo = crearNodo(el);
  estado.nodos.set(el.id, nodo);
  $('#capa-elementos').appendChild(nodo);
  seleccionar(el.id);
  actualizarVacio();
  return el;
}

// =====================================================================
// Líneas (flechas)
// =====================================================================
function cancelarLinea() {
  if (estado.origenLinea) estado.nodos.get(estado.origenLinea)?.classList.remove('seleccionado');
  estado.origenLinea = null;
  if (estado.seleccionado) estado.nodos.get(estado.seleccionado)?.classList.add('seleccionado');
}

async function manejarLinea(id) {
  if (!id) { cancelarLinea(); return; }
  if (!estado.origenLinea) {
    estado.origenLinea = id;
    estado.nodos.get(id).classList.add('seleccionado');
    mostrarMensaje('Ahora haz clic en el elemento de destino', false, 4000);
    return;
  }
  const origen = estado.origenLinea;
  cancelarLinea();
  if (origen === id) return;

  // No repetir la misma flecha entre los mismos dos elementos y en el mismo sentido
  const repetida = [...estado.conexiones.values()].some((c) => c.origen_id === origen && c.destino_id === id);
  if (repetida) {
    mostrarMensaje('Ya existe una flecha entre esos dos elementos', true);
    return;
  }

  const r = await guardar(Elemento.crearConexion(estado.tableroId, origen, id));
  if (r.ok) {
    estado.conexiones.set(r.datos.id, r.datos);
    elegirHerramienta(null);
    seleccionarFlecha(r.datos.id);                       // queda seleccionada para editarla enseguida
  }
}

// =====================================================================
// Líneas (flechas): dibujar
// =====================================================================

function rectDe(id) {
  const el = estado.elementos.get(id);
  const nodo = estado.nodos.get(id);
  if (!el || !nodo) return null;
  return { x: el.pos_x, y: el.pos_y, w: nodo.offsetWidth, h: nodo.offsetHeight };
}

// Elige los puntos medios de los lados que quedan más cerca entre sí
function ancla(a, b) {
  const lados = (r) => [
    { x: r.x + r.w / 2, y: r.y,           v: [0, -1] },
    { x: r.x + r.w,     y: r.y + r.h / 2, v: [1, 0] },
    { x: r.x + r.w / 2, y: r.y + r.h,     v: [0, 1] },
    { x: r.x,           y: r.y + r.h / 2, v: [-1, 0] },
  ];
  let mejor = null;
  for (const p of lados(a)) {
    for (const q of lados(b)) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!mejor || d < mejor.d) mejor = { p, q, d };
    }
  }
  return mejor;
}

function trayecto({ p, q, d }, tipo) {
  if (tipo === 'recta') return `M${p.x},${p.y} L${q.x},${q.y}`;
  const k = Math.max(40, d / 3);
  return `M${p.x},${p.y} C${p.x + p.v[0] * k},${p.y + p.v[1] * k} ${q.x + q.v[0] * k},${q.y + q.v[1] * k} ${q.x},${q.y}`;
}

// Una punta de flecha por cada color usado (se crea la primera vez que hace falta)
function asegurarMarcador(color) {
  const id = `punta-${color.slice(1).toLowerCase()}`;
  const defs = $('#capa-flechas defs');
  if (!defs.querySelector(`#${id}`)) {
    const m = document.createElementNS(SVG_NS, 'marker');
    m.setAttribute('id', id);
    m.setAttribute('viewBox', '0 0 10 10');
    m.setAttribute('refX', '9');
    m.setAttribute('refY', '5');
    m.setAttribute('markerWidth', '6');
    m.setAttribute('markerHeight', '6');
    m.setAttribute('orient', 'auto-start-reverse');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    p.setAttribute('fill', color);
    p.setAttribute('stroke', 'none');
    m.appendChild(p);
    defs.appendChild(m);
  }
  return id;
}

function grosorDe(c) {
  const g = Number(c.grosor);
  return GROSORES.includes(g) ? g : 2;
}

function direccionDe(c) {
  const o = c.punta_origen === 'flecha';
  const d = c.punta_destino === 'flecha';
  return o && d ? 'ambas' : o ? 'origen' : d ? 'destino' : 'ninguna';
}

function dibujarFlechas() {
  const grupo = $('#grupo-flechas');
  grupo.replaceChildren();
  estado.puntoFlecha = null;

  for (const c of estado.conexiones.values()) {
    const a = rectDe(c.origen_id);
    const b = rectDe(c.destino_id);
    if (!a || !b) continue;

    const d = trayecto(ancla(a, b), c.tipo_curva);
    const color = COLOR_HEX.test(c.color ?? '') ? c.color : COLOR_BASE;
    const grosor = grosorDe(c);
    const seleccionada = c.id === estado.flechaSeleccionada;

    // Resplandor alrededor de la flecha seleccionada
    if (seleccionada) {
      const halo = document.createElementNS(SVG_NS, 'path');
      halo.setAttribute('d', d);
      halo.setAttribute('class', 'flecha-halo');
      halo.style.strokeWidth = String(grosor + 8);
      grupo.appendChild(halo);
    }

    const linea = document.createElementNS(SVG_NS, 'path');
    linea.setAttribute('d', d);
    linea.style.stroke = color;
    linea.style.strokeWidth = String(grosor);
    const marcador = `url(#${asegurarMarcador(color)})`;
    if (c.punta_destino === 'flecha') linea.setAttribute('marker-end', marcador);
    if (c.punta_origen === 'flecha') linea.setAttribute('marker-start', marcador);
    if (c.estilo_linea === 'punteada') {
      linea.style.strokeDasharray = `1 ${grosor * 3 + 2}`;
      linea.style.strokeLinecap = 'round';
    } else if (c.estilo_linea === 'discontinua') {
      linea.style.strokeDasharray = `${grosor * 4 + 4} ${grosor * 3 + 3}`;
    }
    grupo.appendChild(linea);

    // Punto medio: para la etiqueta y para colocar la barra de la flecha seleccionada
    if (seleccionada || c.etiqueta) {
      let medio = null;
      try { medio = linea.getPointAtLength(linea.getTotalLength() / 2); } catch { /* sin medida */ }
      if (medio) {
        if (seleccionada) estado.puntoFlecha = { x: medio.x, y: medio.y };
        if (c.etiqueta) {
          const texto = document.createElementNS(SVG_NS, 'text');
          texto.setAttribute('x', medio.x);
          texto.setAttribute('y', medio.y - 6);
          texto.setAttribute('text-anchor', 'middle');
          texto.setAttribute('class', 'flecha-etiqueta');
          texto.textContent = c.etiqueta;                // textContent evita inyección de HTML
          grupo.appendChild(texto);
        }
      }
    }

    // Zona más ancha e invisible para poder hacer clic sobre la flecha
    const area = document.createElementNS(SVG_NS, 'path');
    area.setAttribute('d', d);
    area.style.stroke = 'transparent';
    area.style.strokeWidth = String(16 + grosor);
    area.style.pointerEvents = 'stroke';
    if (!estado.soloLectura) {
      area.style.cursor = 'pointer';
      const ayuda = document.createElementNS(SVG_NS, 'title');
      ayuda.textContent = 'Haz clic para editar la flecha';
      area.appendChild(ayuda);
      area.addEventListener('mouseenter', () => { linea.style.opacity = '.6'; });
      area.addEventListener('mouseleave', () => { linea.style.opacity = ''; });
      area.addEventListener('click', (e) => {
        if (estado.herramienta) return;                  // con una herramienta activa, el clic sigue su camino normal
        e.stopPropagation();
        seleccionarFlecha(c.id);
      });
    }
    grupo.appendChild(area);
  }

  posicionarBarraFlecha();
}

// =====================================================================
// Líneas (flechas): seleccionar, editar y eliminar
// =====================================================================
function seleccionarFlecha(id) {
  if (!estado.conexiones.has(id)) return;
  quitarSeleccionElemento();
  estado.flechaSeleccionada = id;
  sincronizarBarraFlecha();
  dibujarFlechas();                                      // dibuja el resplandor y coloca la barra
}

function quitarSeleccionFlecha() {
  if (estado.flechaSeleccionada === null) return;
  estado.flechaSeleccionada = null;
  dibujarFlechas();                                      // quita el resplandor y oculta la barra
}

// Rellena los controles de la barra con los valores de la flecha seleccionada
function sincronizarBarraFlecha() {
  const c = estado.conexiones.get(estado.flechaSeleccionada);
  if (!c) return;
  $('#flecha-etiqueta').value = c.etiqueta ?? '';
  $('#flecha-direccion').value = direccionDe(c);
  $('#flecha-estilo').value = ESTILOS.includes(c.estilo_linea) ? c.estilo_linea : 'solida';
  $('#flecha-curva').value = CURVAS.includes(c.tipo_curva) ? c.tipo_curva : 'curva';
  $('#flecha-grosor').value = String(grosorDe(c));
  const actual = COLOR_HEX.test(c.color ?? '') ? c.color.toLowerCase() : '';
  document.querySelectorAll('#flecha-colores .swatch').forEach((b) => {
    b.classList.toggle('activo', (b.dataset.hex || '') === actual);
  });
}

function posicionarBarraFlecha() {
  const barra = $('#barra-flecha');
  const c = estado.conexiones.get(estado.flechaSeleccionada);
  if (!c || estado.soloLectura || !estado.puntoFlecha) { barra.hidden = true; return; }
  barra.hidden = false;
  const r = $('#lienzo').getBoundingClientRect();
  const x = r.left + estado.puntoFlecha.x * estado.zoom;
  const y = r.top + estado.puntoFlecha.y * estado.zoom;
  const arriba = y - barra.offsetHeight - 14;
  barra.style.top = `${arriba < 56 ? y + 14 : arriba}px`;
  barra.style.left = `${Math.min(Math.max(x - barra.offsetWidth / 2, 80), window.innerWidth - barra.offsetWidth - 8)}px`;
}

// UPDATE: se ve el cambio al instante y, si el guardado falla, se deshace
async function actualizarFlecha(cambios) {
  const c = estado.conexiones.get(estado.flechaSeleccionada);
  if (!c || estado.soloLectura) return;
  const anterior = {};
  for (const k of Object.keys(cambios)) anterior[k] = c[k];

  Object.assign(c, cambios);
  dibujarFlechas();
  const r = await guardar(Elemento.actualizarConexion(c.id, cambios));
  if (!r.ok) {
    Object.assign(c, anterior);
    dibujarFlechas();
    if (estado.flechaSeleccionada === c.id) sincronizarBarraFlecha();
  }
}

// DELETE
async function eliminarFlechaSeleccionada() {
  const id = estado.flechaSeleccionada;
  if (id === null || estado.soloLectura) return;
  if (!confirm('¿Eliminar esta flecha?')) return;
  const r = await guardar(Elemento.eliminarConexion(id));
  if (!r.ok) return;
  estado.conexiones.delete(id);
  estado.flechaSeleccionada = null;
  dibujarFlechas();
}

function activarBarraFlecha() {
  const etiqueta = $('#flecha-etiqueta');
  etiqueta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); etiqueta.blur(); }
  });
  etiqueta.addEventListener('change', () => {
    const c = estado.conexiones.get(estado.flechaSeleccionada);
    const texto = etiqueta.value.trim().slice(0, 100);
    if (!c || texto === (c.etiqueta ?? '')) return;
    actualizarFlecha({ etiqueta: texto || null });
  });

  $('#flecha-direccion').addEventListener('change', (e) => {
    const puntas = DIRECCIONES[e.target.value];
    if (puntas) actualizarFlecha({ ...puntas });
  });
  $('#flecha-estilo').addEventListener('change', (e) => {
    if (ESTILOS.includes(e.target.value)) actualizarFlecha({ estilo_linea: e.target.value });
  });
  $('#flecha-curva').addEventListener('change', (e) => {
    if (CURVAS.includes(e.target.value)) actualizarFlecha({ tipo_curva: e.target.value });
  });
  $('#flecha-grosor').addEventListener('change', (e) => {
    const g = Number(e.target.value);
    if (GROSORES.includes(g)) actualizarFlecha({ grosor: g });
  });
  document.querySelectorAll('#flecha-colores .swatch').forEach((b) => {
    b.addEventListener('click', () => {
      const color = b.dataset.hex || null;
      document.querySelectorAll('#flecha-colores .swatch').forEach((x) => x.classList.toggle('activo', x === b));
      actualizarFlecha({ color });
    });
  });
  $('#btn-flecha-eliminar').addEventListener('click', eliminarFlechaSeleccionada);
}

// =====================================================================
// Arrastrar y redimensionar
// =====================================================================
function marcarArrastre() {
  estado.huboArrastre = true;                      // evita que el "clic" posterior seleccione o coloque algo
  setTimeout(() => { estado.huboArrastre = false; }, 0);
}

function iniciarArrastre(e, nodo, el) {
  const inicio = { x: e.clientX, y: e.clientY, left: el.pos_x, top: el.pos_y };
  let movido = false;

  const mover = (ev) => {
    const dx = (ev.clientX - inicio.x) / estado.zoom;
    const dy = (ev.clientY - inicio.y) / estado.zoom;
    if (!movido) {
      if (Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y) < 4) return;   // todavía es un clic
      movido = true;
      nodo.classList.add('arrastrando');
    }
    el.pos_x = Math.max(0, Math.round(inicio.left + dx));
    el.pos_y = Math.max(0, Math.round(inicio.top + dy));
    nodo.style.left = `${el.pos_x}px`;
    nodo.style.top = `${el.pos_y}px`;
    dibujarFlechas();
    posicionarBarra();
  };

  const soltar = async () => {
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', soltar);
    window.removeEventListener('pointercancel', soltar);
    nodo.classList.remove('arrastrando');
    if (!movido) return;
    marcarArrastre();
    seleccionar(el.id);
    const antes = { pos_x: inicio.left, pos_y: inicio.top };
    const despues = { pos_x: el.pos_x, pos_y: el.pos_y };
    const r = await guardar(Elemento.actualizarElemento(el.id, despues));
    if (r.ok) {
      Historial.registrar({
        nombre: 'mover',
        deshacer: () => aplicarElemento(el.id, antes),
        rehacer: () => aplicarElemento(el.id, despues),
      });
    }
  };

  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', soltar);
  window.addEventListener('pointercancel', soltar);
}

function iniciarRedimension(e, nodo, el) {
  e.preventDefault();
  const inicio = { x: e.clientX, y: e.clientY, ancho: nodo.offsetWidth, alto: nodo.offsetHeight };
  const cambiaAlto = el.tipo === 'nota' || el.tipo === 'imagen';
  let movido = false;

  const mover = (ev) => {
    movido = true;
    el.ancho = Math.max(ANCHO_MIN, Math.round(inicio.ancho + (ev.clientX - inicio.x) / estado.zoom));
    if (cambiaAlto) el.alto = Math.max(ALTO_MIN, Math.round(inicio.alto + (ev.clientY - inicio.y) / estado.zoom));
    aplicarGeometria(nodo, el);
    dibujarFlechas();
    posicionarBarra();
  };

  const soltar = async () => {
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', soltar);
    window.removeEventListener('pointercancel', soltar);
    if (!movido) return;
    marcarArrastre();
    await guardar(Elemento.actualizarElemento(el.id, cambiaAlto ? { ancho: el.ancho, alto: el.alto } : { ancho: el.ancho }));
  };

  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', soltar);
  window.addEventListener('pointercancel', soltar);
}

// =====================================================================
// Edición de textos (doble clic)
// =====================================================================
function editarContenido(el, campo) {
  const cfg = CONFIG_CAMPO[el.tipo];
  if (!cfg || !campo) return;
  editarCampo(campo, cfg, async (texto) => {
    const nombre = campo.dataset.campo;
    const r = await guardar(Elemento.actualizarDetalle(el, { [nombre]: texto }));
    if (r.ok) el.detalle[nombre] = texto;
    return r.ok;
  });
}

// Convierte un campo en editable. Enter guarda (en notas: Ctrl+Enter), Escape cancela.
function editarCampo(campo, { multilinea = false, max = 500, vacioPermitido = false } = {}, alGuardar) {
  if (estado.soloLectura || campo.isContentEditable) return;
  const nodo = campo.closest('.elemento');
  const original = campo.textContent;

  try { campo.contentEditable = 'plaintext-only'; } catch { campo.contentEditable = 'true'; }
  if (!campo.isContentEditable) campo.contentEditable = 'true';
  nodo.classList.add('editando');
  campo.focus();

  const rango = document.createRange();
  rango.selectNodeContents(campo);
  rango.collapse(false);
  const seleccion = getSelection();
  seleccion.removeAllRanges();
  seleccion.addRange(rango);

  let terminado = false;

  const terminar = async (conservar) => {
    if (terminado) return;
    terminado = true;
    campo.removeEventListener('blur', alPerderFoco);
    campo.removeEventListener('keydown', alTeclear);
    const escrito = campo.innerText.replace(/\u00a0/g, ' ');
    campo.contentEditable = 'false';
    nodo.classList.remove('editando');

    let texto = multilinea ? escrito.replace(/\s+$/, '') : escrito.replace(/\s*\n\s*/g, ' ').trim();
    texto = texto.slice(0, max);

    if (!conservar || texto === original || (!texto && !vacioPermitido)) {
      campo.textContent = original;
      return;
    }
    campo.textContent = texto;
    const guardado = await alGuardar(texto);
    if (!guardado) campo.textContent = original;
  };

  const alPerderFoco = () => terminar(true);
  const alTeclear = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); terminar(false); }
    else if (e.key === 'Enter' && (!multilinea || e.ctrlKey)) { e.preventDefault(); terminar(true); }
  };

  campo.addEventListener('blur', alPerderFoco);
  campo.addEventListener('keydown', alTeclear);
}

// =====================================================================
// Enlaces e imágenes (ventana)
// =====================================================================
function urlSegura(texto) {
  try {
    const u = new URL(texto);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function dominioDe(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function abrirModalRecurso(tipo, x, y) {
  estado.pendiente = { tipo, x, y };
  const esEnlace = tipo === 'enlace';
  $('#form-recurso').reset();
  $('#mensaje-recurso').textContent = '';
  $('#modal-recurso-titulo').textContent = esEnlace ? 'Añadir enlace' : 'Añadir imagen';
  $('#campos-enlace').hidden = !esEnlace;
  $('#campos-imagen').hidden = esEnlace;
  $('#enlace-url').required = esEnlace;     // solo es obligatorio cuando se ve (si no, bloquearía el envío)
  modalRecurso?.show();
}

async function enviarRecurso(e) {
  e.preventDefault();
  const pendiente = estado.pendiente;
  if (!pendiente) return;

  const msg = $('#mensaje-recurso');
  const boton = $('#form-recurso').querySelector('button[type="submit"]');
  msg.textContent = '';
  boton.disabled = true;

  try {
    if (pendiente.tipo === 'enlace') {
      const url = $('#enlace-url').value.trim();
      if (!urlSegura(url)) throw new Error('La dirección debe empezar por http:// o https://');
      const titulo = $('#enlace-titulo').value.trim() || dominioDe(url);
      await crearEnLienzo('enlace', pendiente.x, pendiente.y, { url, titulo });
    } else {
      const archivo = $('#imagen-archivo').files[0];
      let url = $('#imagen-url').value.trim();
      if (archivo) {
        msg.textContent = 'Subiendo imagen...';
        url = await Elemento.subirImagen(estado.tableroId, archivo);
      } else if (!urlSegura(url)) {
        throw new Error('Elige una imagen o escribe una dirección que empiece por http:// o https://');
      }
      await crearEnLienzo('imagen', pendiente.x, pendiente.y, { url });
    }
    modalRecurso?.hide();
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = '#ff7b72';
  } finally {
    boton.disabled = false;
  }
}

// =====================================================================
// Zoom
// =====================================================================
function ajustarZoom(valor) {
  estado.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(valor * 10) / 10));
  $('#lienzo').style.setProperty('--zoom', estado.zoom);
  $('#zoom-valor').textContent = `${Math.round(estado.zoom * 100)}%`;
  reposicionarBarras();
}

// =====================================================================
// Eventos
// =====================================================================
function conectarEventos() {
  const visor = $('#visor');

  // Herramientas
  document.querySelectorAll('.herramienta').forEach((b) => {
    b.addEventListener('click', () => elegirHerramienta(b.dataset.herramienta));
  });

  // Clic en el lienzo: seleccionar, colocar un elemento nuevo o unir con una línea
  visor.addEventListener('click', (e) => {
    if (estado.huboArrastre) return;
    const nodo = e.target.closest('.elemento');
    const id = nodo ? Number(nodo.dataset.id) : null;

    if (estado.herramienta === 'linea') { manejarLinea(id); return; }
    if (!nodo && estado.herramienta) {
      const { x, y } = coordenadas(e);
      colocar(estado.herramienta, x, y);
      return;
    }
    if (nodo) seleccionar(id);
    else deseleccionar();
  });

  // Empezar a arrastrar o redimensionar
  visor.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || estado.soloLectura || estado.herramienta) return;
    const nodo = e.target.closest('.elemento');
    if (!nodo) return;
    const el = estado.elementos.get(Number(nodo.dataset.id));
    if (!el) return;

    if (e.target.closest('.redimensionar')) { iniciarRedimension(e, nodo, el); return; }
    if (e.target.closest('input, textarea, button, a') || e.target.isContentEditable) return;
    iniciarArrastre(e, nodo, el);
  });

  // Doble clic: editar el texto
  visor.addEventListener('dblclick', (e) => {
    if (estado.soloLectura || estado.herramienta) return;
    const nodo = e.target.closest('.elemento');
    const campo = e.target.closest('[data-campo]');
    if (!nodo || !campo) return;
    editarContenido(estado.elementos.get(Number(nodo.dataset.id)), campo);
  });

  visor.addEventListener('scroll', reposicionarBarras);
  window.addEventListener('resize', reposicionarBarras);

  // Teclado
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) rehacerUI(); else deshacerUI();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      rehacerUI();
      return;
    }
    if (e.key === 'Escape') { elegirHerramienta(null); deseleccionar(); }
    else if (e.key === 'Delete' && !estado.soloLectura) {
      if (estado.flechaSeleccionada !== null) eliminarFlechaSeleccionada();
      else if (estado.seleccionado) eliminarSeleccionado();
    }  
  });

  // Barra del elemento
  document.querySelectorAll('#barra-elemento .color').forEach((b) => {
    b.addEventListener('click', () => cambiarColor(b.dataset.color));
  });
  $('#btn-al-frente').addEventListener('click', alFrente);
  $('#btn-eliminar').addEventListener('click', eliminarSeleccionado);
  activarBarraFlecha();

  // Zoom
  $('#btn-zoom-mas').addEventListener('click', () => ajustarZoom(estado.zoom + ZOOM_PASO));
  $('#btn-zoom-menos').addEventListener('click', () => ajustarZoom(estado.zoom - ZOOM_PASO));
  $('#btn-zoom-reset').addEventListener('click', () => ajustarZoom(1));
  visor.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    ajustarZoom(estado.zoom + (e.deltaY < 0 ? ZOOM_PASO : -ZOOM_PASO));
  }, { passive: false });

  // Nombre del tablero
  const nombre = $('#tablero-nombre');
  nombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') nombre.blur(); });
  nombre.addEventListener('change', async () => {
    const nuevo = nombre.value.trim().slice(0, 200);
    if (!nuevo) { nombre.value = estado.tablero.nombre; return; }
    const r = await guardar(Tablero.renombrarTablero(estado.tableroId, nuevo));
    if (r.ok) {
      estado.tablero.nombre = nuevo;
      document.title = `${nuevo} – Dario Pex`;
    } else {
      nombre.value = estado.tablero.nombre;
    }
  });

  // Ventana de enlaces e imágenes
  $('#form-recurso').addEventListener('submit', enviarRecurso);
  const modalEl = $('#modal-recurso');
  modalEl.addEventListener('shown.bs.modal', () => {
    (estado.pendiente?.tipo === 'enlace' ? $('#enlace-url') : $('#imagen-archivo')).focus();
  });
  modalEl.addEventListener('hidden.bs.modal', () => {
    estado.pendiente = null;
    elegirHerramienta(null);
  });

  // Cerrar sesión
  $('#btn-salir').addEventListener('click', async () => {
    await Usuario.cerrarSesion();
    location.href = 'inicioseccion.html';
  });

  Historial.iniciarHistorial(() => {
  $('#btn-deshacer').disabled = !Historial.puedeDeshacer();
  $('#btn-rehacer').disabled = !Historial.puedeRehacer();
  });
  $('#btn-deshacer').addEventListener('click', deshacerUI);
  $('#btn-rehacer').addEventListener('click', rehacerUI);
}