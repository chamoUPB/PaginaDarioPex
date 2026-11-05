import { supabase } from './supabaseClient.js';
import { verificar } from './utils.js';

export async function nombreDisponible(nombre) {
  const { data, error } = await supabase.rpc('nombre_usuario_disponible', { p_nombre: nombre });
  if (error) throw new Error('No se pudo verificar el nombre de usuario');
  return data;
}

export async function registrar({ correo, contrasena, nombre_usuario, telefono = null }) {
  if (!(await nombreDisponible(nombre_usuario))) {
    throw new Error('Ese nombre de usuario ya está en uso');
  }

  // El trigger de la base de datos crea la fila en la tabla "usuarios"
  const { data, error } = await supabase.auth.signUp({
    email: correo,
    password: contrasena,
    options: { data: { nombre_usuario, telefono } },
  });

  if (error) {
    if (/already registered/i.test(error.message)) throw new Error('Ese correo ya está registrado');
    if (/database error/i.test(error.message)) {
      throw new Error('No se pudo crear el perfil. Revisa que el trigger esté creado y que el correo o usuario no existan ya.');
    }
    throw new Error(error.message);
  }
  return data;
}

export async function iniciarSesion(correo, contrasena) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: correo, password: contrasena });
  if (error) {
    if (/not confirmed/i.test(error.message)) {
      throw new Error('Debes confirmar tu correo antes de iniciar sesión');
    }
    throw new Error('Correo o contraseña incorrectos');
  }
  return data;
}

export const cerrarSesion = () => supabase.auth.signOut();

// authUserId = el UUID de Supabase Auth (session.user.id)
export async function obtenerPerfil(authUserId) {
  return verificar(await supabase
    .from('usuarios')
    .select('id_usuarios, nombre_usuario, correo, telefono, rol, id_foto')
    .eq('auth_user_id', authUserId)
    .single());
}

export async function sesionActual() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  // getUser() consulta al servidor: falla si el usuario fue borrado o el token ya no sirve
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    await supabase.auth.signOut({ scope: 'local' });   // borra la sesión guardada en el navegador
    return null;
  }
  return session;
}