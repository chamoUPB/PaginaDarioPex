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

  const { data, error } = await supabase.auth.signUp({
    email: correo,
    password: contrasena,
    options: { data: { nombre_usuario, telefono } },
  });

  if (error) {
    console.error('Error de signUp:', error);
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

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    await supabase.auth.signOut({ scope: 'local' });
    return null;
  }
  return session;
}

// ---------------- Perfil ----------------
const CAMPOS_PERFIL = 'id_usuarios, nombre_usuario, correo, telefono, rol, foto_url';

// authUserId = el UUID de Supabase Auth (session.user.id), que ahora es también la clave de "usuarios"
export async function obtenerPerfil(authUserId) {
  return verificar(await supabase
    .from('usuarios')
    .select(CAMPOS_PERFIL)
    .eq('id_usuarios', authUserId)
    .single());
}

export async function actualizarPerfil(idUsuario, { nombre_usuario, telefono }) {
  return verificar(await supabase
    .from('usuarios')
    .update({ nombre_usuario, telefono })
    .eq('id_usuarios', idUsuario)
    .select(CAMPOS_PERFIL)
    .single());
}

// ---------------- Contraseña ----------------
export async function cambiarContrasena(correo, actual, nueva) {
  // QUITAR ESTAS 3 LÍNEAS si no quieres pedir la contraseña actual (no recomendado)
  const { error: errActual } = await supabase.auth.signInWithPassword({ email: correo, password: actual });
  if (errActual) throw new Error('La contraseña actual no es correcta');

  const { error } = await supabase.auth.updateUser({ password: nueva });
  if (error) {
    console.error('Error al cambiar contraseña:', error);
    if (/different from the old|same password/i.test(error.message)) {
      throw new Error('La nueva contraseña debe ser distinta a la actual');
    }
    if (/at least|weak|short/i.test(error.message)) {
      throw new Error('La nueva contraseña no cumple los requisitos de seguridad');
    }
    throw new Error(error.message);
  }
}

// ---------------- Foto de perfil ----------------
const EXTENSIONES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 2 * 1024 * 1024;   // 2 MB

export async function subirFotoPerfil(authUserId, archivo) {
  const ext = EXTENSIONES[archivo.type];
  if (!ext) throw new Error('Formato no permitido. Usa JPG, PNG o WebP');
  if (archivo.size > MAX_BYTES) throw new Error('La imagen no puede pesar más de 2 MB');

  const nombre = `${Date.now()}.${ext}`;            // nombre único: evita problemas de caché
  const ruta = `${authUserId}/${nombre}`;           // cada usuario tiene su propia carpeta
  const bucket = supabase.storage.from('avatares');

  const { error } = await bucket.upload(ruta, archivo, { contentType: archivo.type });
  if (error) throw new Error('No se pudo subir la imagen: ' + error.message);

  const { data } = bucket.getPublicUrl(ruta);
  const { error: errRpc } = await supabase.rpc('guardar_foto_perfil', { p_url: data.publicUrl });
  if (errRpc) {
    console.error('Error en guardar_foto_perfil:', errRpc);
    await bucket.remove([ruta]);
    throw new Error('No se pudo guardar la foto en tu perfil');
  }

  await borrarFotosAnteriores(authUserId, nombre);
  return data.publicUrl;
}

export async function quitarFotoPerfil(authUserId) {
  const { error } = await supabase.rpc('quitar_foto_perfil');
  if (error) throw new Error('No se pudo quitar la foto');
  await borrarFotosAnteriores(authUserId, null);
}

// Limpieza opcional: si falla, no pasa nada
async function borrarFotosAnteriores(authUserId, nombreAConservar) {
  try {
    const bucket = supabase.storage.from('avatares');
    const { data: archivos } = await bucket.list(authUserId);
    const sobran = (archivos ?? [])
      .filter((a) => !a.name.startsWith('.') && a.name !== nombreAConservar)
      .map((a) => `${authUserId}/${a.name}`);
    if (sobran.length) await bucket.remove(sobran);
  } catch { /* no es importante */ }
}