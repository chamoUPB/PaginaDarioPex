import { supabase } from './supabaseClient.js';
import { verificar } from './utils.js';

// ---------------- Registro e inicio de sesión ----------------
export async function nombreDisponible(nombre) {
  const { data, error } = await supabase.rpc('nombre_usuario_disponible', { p_nombre: nombre });
  if (error) {
    console.error('Error en nombre_usuario_disponible:', error);
    throw new Error('No se pudo verificar el nombre de usuario');
  }
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
    console.error('Error de signUp:', error);   // el detalle aparece en F12 > Console
    const m = error.message;
    if (/already registered/i.test(m)) throw new Error('Ese correo ya está registrado');
    if (/rate limit|only request this after/i.test(m)) {
      throw new Error('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
    }
    if (/database error/i.test(m)) {
      throw new Error('No se pudo crear el perfil. Revisa que el trigger esté creado y que el correo o usuario no existan ya.');
    }
    throw new Error(m);
  }

  // Con la confirmación por correo activa, un correo repetido no da error: devuelve un usuario sin identidades
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    throw new Error('Ese correo ya está registrado');
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

// ---------------- Perfil ----------------
// authUserId = el UUID de Supabase Auth (session.user.id)
export async function obtenerPerfil(authUserId) {
  return verificar(await supabase
    .from('usuarios')
    .select('id_usuarios, nombre_usuario, correo, telefono, rol, id_foto')
    .eq('id_usuarios', authUserId)
    .single());
}

export async function actualizarPerfil(idUsuario, { nombre_usuario, telefono }) {
  return verificar(await supabase
    .from('usuarios')
    .update({ nombre_usuario, telefono })
    .eq('id_usuarios', idUsuario)
    .select('id_usuarios, nombre_usuario, correo, telefono, rol, id_foto')
    .single());
}