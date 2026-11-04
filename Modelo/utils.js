// Convierte los errores de Supabase en mensajes claros
export function verificar({ data, error }) {
  if (error) {
    const mensajes = {
      '42501': 'No tienes permiso para hacer esto',
      'PGRST116': 'No existe o no tienes acceso',
      '23505': 'Ya existe un registro con esos datos',
    };
    throw new Error(mensajes[error.code] ?? error.message);
  }
  return data;
}

// Deja pasar solo los campos permitidos
export const elegir = (obj, permitidos) =>
  Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => permitidos.includes(k)));

// Si Supabase devuelve una lista de un elemento, toma ese elemento
export const uno = (x) => (Array.isArray(x) ? x[0] : x);