import { supabase } from './supabaseClient.js';
import { verificar } from './utils.js';

const BUCKET = 'imagenes-tablero';
const MAX_BYTES = 2 * 1024 * 1024;   // 2 MB
const EXTENSIONES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const EDITABLES = ['pos_x', 'pos_y', 'ancho', 'alto', 'z_index', 'color'];
const DETALLE = {
  nota:         { tabla: 'notas',         campos: ['texto'] },
  lista_tareas: { tabla: 'listas_tareas', campos: ['titulo'] },
  enlace:       { tabla: 'enlaces',       campos: ['titulo'] },
  imagen:       { tabla: 'imagenes',      campos: [] },
};

const uno = (x) => (Array.isArray(x) ? x[0] : x);
const ELEMENTO_CON_DETALLE = '*, notas(*), listas_tareas(*, tareas(*)), imagenes(*), enlaces(*)';

// Deja cada elemento con la forma { ...columnas, detalle: {...}, tareas: [...] }
function normalizar(fila) {
  const { notas, listas_tareas, imagenes, enlaces, ...base } = fila;
  const lista = uno(listas_tareas);
  const { tareas = [], ...detalleLista } = lista ?? {};
  const detalle = uno(notas) ?? uno(imagenes) ?? uno(enlaces) ?? (lista ? detalleLista : {});
  return { ...base, detalle, tareas: [...tareas].sort((a, b) => a.orden - b.orden) };
}

// ---------------- Elementos ----------------
export async function cargarElementos(tableroId) {
  const filas = verificar(await supabase
    .from('elementos').select(ELEMENTO_CON_DETALLE)
    .eq('tablero_id', tableroId).order('z_index'));
  return filas.map(normalizar);
}

async function cargarElemento(id) {
  return normalizar(verificar(await supabase
    .from('elementos').select(ELEMENTO_CON_DETALLE).eq('id', id).single()));
}

// Crea el elemento y su detalle en un solo paso (función crear_elemento de la base de datos)
export async function crearElemento(tableroId, tipo, geom, datos = {}) {
  const id = verificar(await supabase.rpc('crear_elemento', {
    p_tablero: tableroId, p_tipo: tipo, p_x: geom.x, p_y: geom.y,
    p_ancho: geom.ancho ?? null, p_alto: geom.alto ?? null, p_color: geom.color ?? null,
    p_texto: datos.texto ?? null, p_titulo: datos.titulo ?? null, p_url: datos.url ?? null,
  }));
  return cargarElemento(id);
}

export async function actualizarElemento(id, cambios) {
  const limpio = Object.fromEntries(Object.entries(cambios).filter(([k]) => EDITABLES.includes(k)));
  if (!Object.keys(limpio).length) return;
  verificar(await supabase.from('elementos').update(limpio).eq('id', id).select('id').single());
}

export async function actualizarDetalle(el, cambios) {
  const cfg = DETALLE[el.tipo];
  const limpio = Object.fromEntries(Object.entries(cambios).filter(([k]) => cfg?.campos.includes(k)));
  if (!cfg || !Object.keys(limpio).length) return;
  verificar(await supabase.from(cfg.tabla).update(limpio).eq('elemento_id', el.id).select('elemento_id').single());
}

export async function eliminarElemento(el) {
  verificar(await supabase.from('elementos').delete().eq('id', el.id).select('id').single());
  if (el.tipo === 'imagen') await borrarArchivo(el.detalle?.url);
}

// ---------------- Tareas ----------------
export async function crearTarea(listaId, texto, orden) {
  return verificar(await supabase
    .from('tareas').insert({ lista_id: listaId, texto, orden }).select().single());
}

export async function actualizarTarea(id, cambios) {
  const limpio = Object.fromEntries(Object.entries(cambios).filter(([k]) => ['texto', 'completada', 'orden'].includes(k)));
  verificar(await supabase.from('tareas').update(limpio).eq('id', id).select('id').single());
}

export async function eliminarTarea(id) {
  verificar(await supabase.from('tareas').delete().eq('id', id).select('id').single());
}

// ---------------- Conexiones (flechas) ----------------
export async function cargarConexiones(tableroId) {
  return verificar(await supabase.from('conexiones').select('*').eq('tablero_id', tableroId));
}

export async function crearConexion(tableroId, origenId, destinoId) {
  return verificar(await supabase
    .from('conexiones')
    .insert({ tablero_id: tableroId, origen_id: origenId, destino_id: destinoId })
    .select().single());
}

export async function eliminarConexion(id) {
  verificar(await supabase.from('conexiones').delete().eq('id', id).select('id').single());
}

// ---------------- Imágenes ----------------
export async function subirImagen(tableroId, archivo) {
  const ext = EXTENSIONES[archivo.type];
  if (!ext) throw new Error('Formato no permitido. Usa JPG, PNG o WebP');
  if (archivo.size > MAX_BYTES) throw new Error('La imagen no puede pesar más de 2 MB');

  const ruta = `${tableroId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bucket = supabase.storage.from(BUCKET);
  const { error } = await bucket.upload(ruta, archivo, { contentType: archivo.type });
  if (error) throw new Error('No se pudo subir la imagen: ' + error.message);
  return bucket.getPublicUrl(ruta).data.publicUrl;
}

async function borrarArchivo(url) {
  const marca = `/object/public/${BUCKET}/`;
  const i = url ? url.indexOf(marca) : -1;
  if (i < 0) return;                                   // era una imagen externa: no hay archivo propio que borrar
  try {
    await supabase.storage.from(BUCKET).remove([decodeURIComponent(url.slice(i + marca.length))]);
  } catch { /* no es importante */ }
}