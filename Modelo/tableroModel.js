import { supabase } from './supabaseClient.js';
import { verificar } from './utils.js';

const CAMPOS = 'id, nombre, propietario_id, tablero_padre_id';
const BUCKET_IMAGENES = 'imagenes-tablero';
const NOMBRE_MAX = 200;

// Limpia y valida el nombre de un tablero
function validarNombre(nombre) {
  const limpio = String(nombre ?? '').trim();
  if (!limpio) throw new Error('El nombre del tablero no puede estar vacío');
  if (limpio.length > NOMBRE_MAX) throw new Error(`El nombre no puede superar los ${NOMBRE_MAX} caracteres`);
  return limpio;
}

// =====================================================================
// CREATE
// =====================================================================
// propietarioId = UUID del usuario (perfilActual.id_usuarios).
// padreId = id del tablero que lo contiene, si es un subtablero.
export async function crearTablero(nombre, propietarioId, padreId = null) {
  return verificar(await supabase
    .from('tableros')
    .insert({
      nombre: validarNombre(nombre),
      propietario_id: propietarioId,
      tablero_padre_id: padreId,
    })
    .select(CAMPOS)
    .single());
}

// =====================================================================
// READ
// =====================================================================
// Tableros principales a los que tiene acceso (propios y compartidos). Lo filtra la base de datos.
export async function listarTableros() {
  return verificar(await supabase
    .from('tableros')
    .select(CAMPOS)
    .is('tablero_padre_id', null)
    .order('id', { ascending: false }));
}

// Tableros que están dentro de otro tablero
export async function listarSubtableros(padreId) {
  return verificar(await supabase
    .from('tableros')
    .select(CAMPOS)
    .eq('tablero_padre_id', padreId)
    .order('id', { ascending: false }));
}

// Un tablero por su id. Falla si no existe o no tienes acceso.
export async function obtenerTablero(id) {
  return verificar(await supabase
    .from('tableros')
    .select(CAMPOS)
    .eq('id', id)
    .single());
}

// =====================================================================
// UPDATE
// =====================================================================
// Solo se puede cambiar el nombre (la base de datos no permite tocar ninguna otra columna)
export async function renombrarTablero(id, nombre) {
  return verificar(await supabase
    .from('tableros')
    .update({ nombre: validarNombre(nombre) })
    .eq('id', id)
    .select(CAMPOS)
    .single());
}

// =====================================================================
// DELETE
// =====================================================================
// Borra el tablero, sus subtableros y todo su contenido (elementos, tareas, flechas...).
// También elimina las imágenes subidas, que viven en Storage y no se borran solas.
export async function eliminarTablero(id) {
  if (!(await puedoEliminar(id))) {
    throw new Error('Solo el propietario puede eliminar este tablero');
  }

  // Las imágenes se borran ANTES: una vez eliminado el tablero, ya no habría permiso para hacerlo
  const ids = await idsDelArbol(id);
  await borrarImagenes(ids);

  verificar(await supabase.from('tableros').delete().eq('id', id).select('id').single());
}

// =====================================================================
// PERMISOS (los decide la base de datos; aquí solo se consultan)
// =====================================================================
// ¿Puede editar el contenido? (propietario, editor o admin)
export async function puedoEditar(id) {
  const { data, error } = await supabase.rpc('acceso_tablero', { p_tablero: id, p_editar: true });
  return !error && data === true;
}

// ¿Puede eliminarlo? (propietario o admin)
export async function puedoEliminar(id) {
  const [propietario, admin] = await Promise.all([
    supabase.rpc('es_propietario_tablero', { p_tablero: id }),
    supabase.rpc('soy_admin'),
  ]);
  return propietario.data === true || admin.data === true;
}

// =====================================================================
// Auxiliares
// =====================================================================
// Id del tablero y de todos los subtableros que contiene, a cualquier profundidad
async function idsDelArbol(id) {
  const ids = [id];
  let nivel = [id];
  while (nivel.length) {
    const { data } = await supabase.from('tableros').select('id').in('tablero_padre_id', nivel);
    nivel = (data ?? []).map((t) => t.id).filter((x) => !ids.includes(x));
    ids.push(...nivel);
  }
  return ids;
}

// Cada tablero guarda sus imágenes en una carpeta con su id. Si falla la limpieza, no se bloquea el borrado.
async function borrarImagenes(ids) {
  try {
    const bucket = supabase.storage.from(BUCKET_IMAGENES);
    for (const id of ids) {
      const { data: archivos } = await bucket.list(String(id), { limit: 1000 });
      const rutas = (archivos ?? [])
        .filter((a) => a.name && !a.name.startsWith('.'))
        .map((a) => `${id}/${a.name}`);
      if (rutas.length) await bucket.remove(rutas);
    }
  } catch (err) {
    console.error('No se pudieron borrar todas las imágenes:', err);
  }
}