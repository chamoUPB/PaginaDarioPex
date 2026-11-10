import { supabase } from './supabaseClient.js';
import { verificar } from './utils.js';

// Tableros principales a los que tiene acceso (RLS filtra: propios y compartidos)
export async function listarTableros() {
  return verificar(await supabase
    .from('tableros')
    .select('id, nombre, propietario_id')
    .is('tablero_padre_id', null)
    .order('id', { ascending: false }));
}

export async function crearTablero(nombre, propietarioId) {
  return verificar(await supabase
    .from('tableros')
    .insert({ nombre, propietario_id: propietarioId })
    .select('id, nombre, propietario_id')
    .single());
}

export async function renombrarTablero(id, nombre) {
  return verificar(await supabase
    .from('tableros')
    .update({ nombre })
    .eq('id', id)
    .select('id, nombre')
    .single());
}