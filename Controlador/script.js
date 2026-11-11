import * as Usuario from '../Modelo/usuarioModel.js';
import * as Tablero from '../Modelo/tableroModel.js';

const $ = (sel) => document.querySelector(sel);

function mostrarMensaje(texto, esError = false) {
  const m = $('#mensaje');
  if (!m) return alert(texto);
  m.textContent = texto;
  m.style.color = esError ? '#b00020' : '#1b7f3b';
}

// Se activa según el formulario que exista en la página
if ($('#registro-form')) paginaRegistro();
if ($('#login-form')) paginaLogin();

// ---------------- Registro ----------------
function paginaRegistro() {
  const form = $('#registro-form');
  const errorPass = $('#password-error');
  const boton = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const correo = $('#email').value.trim();
    const nombre = $('#usuario').value.trim();
    const pass = $('#password').value;
    const pass2 = $('#password2').value;

    errorPass.hidden = pass === pass2;
    if (pass !== pass2) return;

    boton.disabled = true;
    mostrarMensaje('Creando tu cuenta...');
    try {
      const { session } = await Usuario.registrar({
        correo, contrasena: pass, nombre_usuario: nombre,
      });
      if (session) {
        location.href = 'contenido.html';
      } else {
        form.reset();
        mostrarMensaje('Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.');
      }
    } catch (err) {
      mostrarMensaje(err.message, true);
    } finally {
      boton.disabled = false;
    }
  });
}

// ---------------- Inicio de sesión ----------------
function paginaLogin() {
  const form = $('#login-form');
  const boton = form.querySelector('button[type="submit"]');

  Usuario.sesionActual().then((s) => { if (s) location.href = 'contenido.html'; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const correo = $('#username').value.trim();
    const contrasena = $('#password').value;

    boton.disabled = true;
    mostrarMensaje('Entrando...');
    try {
      await Usuario.iniciarSesion(correo, contrasena);
      location.href = 'contenido.html';
    } catch (err) {
      mostrarMensaje(err.message, true);
      $('#password').value = '';
    } finally {
      boton.disabled = false;
    }
  });
}

//--------------- Registro de Sesion---------
const SECCIONES = ['inicio', 'perfil', 'editar', 'seguridad', 'tableros'];   // NUEVO: 'seguridad'
let perfilActual = null;
let authId = null;                                                            // NUEVO

async function cargaPagina() {
  const sesion = await Usuario.sesionActual();
  if (!sesion) {
    location.href = 'inicioseccion.html';
    return;
  }
  authId = sesion.user.id;                                                    // NUEVO

  try {
    perfilActual = await Usuario.obtenerPerfil(authId);
  } catch (err) {
    console.error('Error al cargar el perfil:', err);
    mostrarMensaje('No se pudo cargar tu perfil: ' + err.message, true);
    return;   // TEMPORAL: no cierra la sesión, para poder leer el error
  }

  pintarPerfil();
  activarMenu();
  activarEdicion();
  activarFoto();                                                              // NUEVO
  activarContrasena();                                                        // NUEVO
  activarSalir();
  activarTableros();
}

function iniciales(nombre) {
  return (nombre ?? '?').slice(0, 2).toUpperCase();
}

// NUEVO: muestra la foto de perfil, o las iniciales si no hay
function pintarAvatar(contenedor, p) {
  contenedor.replaceChildren();
  contenedor.classList.add('overflow-hidden');
  if (p.foto_url) {
    const img = document.createElement('img');
    img.src = p.foto_url;
    img.alt = `Foto de ${p.nombre_usuario}`;
    img.className = 'rounded-circle';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover';
    contenedor.appendChild(img);
  } else {
    contenedor.textContent = iniciales(p.nombre_usuario);
  }
}

// Rellena todos los datos del usuario en la página
function pintarPerfil() {
  const p = perfilActual;
  $('#nombre-navbar').textContent = p.nombre_usuario;
  pintarAvatar($('#avatar'), p);                                              // NUEVO
  pintarAvatar($('#foto-preview'), p);                                        // NUEVO
  $('#inicio-nombre').textContent = p.nombre_usuario;
  $('#inicio-correo').textContent = p.correo;
  $('#inicio-rol').textContent = p.rol;

  $('#perfil-usuario').textContent = p.nombre_usuario;
  $('#perfil-correo').textContent = p.correo;
  $('#perfil-telefono').textContent = p.telefono || 'No registrado';
  $('#perfil-rol').textContent = p.rol;

  $('#editar-correo').value = p.correo;
  $('#editar-usuario').value = p.nombre_usuario;
  $('#editar-telefono').value = p.telefono ?? '';
}

// Muestra un panel y oculta los demás
function irA(nombre) {
  if (!SECCIONES.includes(nombre)) nombre = 'inicio';
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== nombre;
  });
  document.querySelectorAll('#menu-usuario [data-seccion]').forEach((enlace) => {
    enlace.classList.toggle('active', enlace.dataset.seccion === nombre);
  });
  mostrarMensaje('');
  history.replaceState(null, '', '#' + nombre);
}

function activarMenu() {
  document.querySelectorAll('[data-seccion]').forEach((enlace) => {
    enlace.addEventListener('click', (e) => {
      e.preventDefault();
      irA(enlace.dataset.seccion);
    });
  });
  document.querySelectorAll('[data-ir]').forEach((boton) => {
    boton.addEventListener('click', () => irA(boton.dataset.ir));
  });
  irA(location.hash.slice(1) || 'inicio');
}

function activarEdicion() {
  const form = $('#form-perfil');
  const boton = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = $('#editar-usuario').value.trim();
    const telefono = $('#editar-telefono').value.trim() || null;

    boton.disabled = true;
    mostrarMensaje('Guardando...');
    try {
      if (nombre.toLowerCase() !== perfilActual.nombre_usuario.toLowerCase()
          && !(await Usuario.nombreDisponible(nombre))) {
        throw new Error('Ese nombre de usuario ya está en uso');
      }

      perfilActual = await Usuario.actualizarPerfil(perfilActual.id_usuarios, {
        nombre_usuario: nombre,
        telefono,
      });
      pintarPerfil();
      irA('perfil');
      mostrarMensaje('Perfil actualizado correctamente');
    } catch (err) {
      mostrarMensaje(err.message, true);
    } finally {
      boton.disabled = false;
    }
  });
}

// NUEVO: foto de perfil
function activarFoto() {
  const input = $('#foto-archivo');
  const btnCambiar = $('#btn-cambiar-foto');
  const btnQuitar = $('#btn-quitar-foto');

  btnCambiar.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const archivo = input.files[0];
    if (!archivo) return;

    btnCambiar.disabled = btnQuitar.disabled = true;
    mostrarMensaje('Subiendo foto...');
    try {
      await Usuario.subirFotoPerfil(authId, archivo);
      perfilActual = await Usuario.obtenerPerfil(authId);
      pintarPerfil();
      mostrarMensaje('Foto actualizada correctamente');
    } catch (err) {
      mostrarMensaje(err.message, true);
    } finally {
      input.value = '';
      btnCambiar.disabled = btnQuitar.disabled = false;
    }
  });

  btnQuitar.addEventListener('click', async () => {
    if (!perfilActual.foto_url) {
      mostrarMensaje('Todavía no tienes foto de perfil', true);
      return;
    }
    btnCambiar.disabled = btnQuitar.disabled = true;
    try {
      await Usuario.quitarFotoPerfil(authId);
      perfilActual = await Usuario.obtenerPerfil(authId);
      pintarPerfil();
      mostrarMensaje('Foto eliminada');
    } catch (err) {
      mostrarMensaje(err.message, true);
    } finally {
      btnCambiar.disabled = btnQuitar.disabled = false;
    }
  });
}

// NUEVO: cambiar contraseña
function activarContrasena() {
  const form = $('#form-contrasena');
  const boton = form.querySelector('button[type="submit"]');
  const error = $('#pass-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const actual = $('#pass-actual').value;
    const nueva = $('#pass-nueva').value;
    const nueva2 = $('#pass-nueva2').value;

    error.hidden = nueva === nueva2;
    if (nueva !== nueva2) return;

    boton.disabled = true;
    mostrarMensaje('Cambiando contraseña...');
    try {
      await Usuario.cambiarContrasena(perfilActual.correo, actual, nueva);
      form.reset();
      mostrarMensaje('Contraseña actualizada correctamente');
    } catch (err) {
      mostrarMensaje(err.message, true);
    } finally {
      boton.disabled = false;
    }
  });
}

function activarSalir() {
  ['#btn-salir', '#btn-salir-nav'].forEach((selector) => {
    $(selector)?.addEventListener('click', async () => {
      await Usuario.cerrarSesion();
      location.href = 'inicioseccion.html';
    });
  });
}

// ---------------- Mis tableros ----------------
function activarTableros() {
  const form = $('#form-tablero');
  const modalEl = $('#modal-tablero');
  const msg = $('#mensaje-tablero');
  const boton = form.querySelector('button[type="submit"]');

  cargarTableros();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = $('#nombre-tablero').value.trim();
    if (!nombre) return;

    boton.disabled = true;
    msg.textContent = '';
    try {
      const t = await Tablero.crearTablero(nombre, perfilActual.id_usuarios);
      location.href = `tablero.html?id=${t.id}`;
    } catch (err) {
      msg.textContent = err.message;
      msg.style.color = '#b00020';
      boton.disabled = false;
    }
  });

  modalEl.addEventListener('shown.bs.modal', () => $('#nombre-tablero').focus());
  modalEl.addEventListener('hidden.bs.modal', () => {
    form.reset();
    msg.textContent = '';
    boton.disabled = false;
  });
}

async function cargarTableros() {
  const lista = $('#lista-tableros');
  try {
    const tableros = await Tablero.listarTableros();
    $('#tableros-cargando').hidden = true;
    $('#sin-tableros').hidden = tableros.length > 0;
    lista.replaceChildren();

    const plantilla = $('#plantilla-tablero');
    tableros.forEach((t) => {
      const tarjeta = plantilla.content.cloneNode(true);
      tarjeta.querySelector('.tablero-nombre').textContent = t.nombre;
      tarjeta.querySelector('.tablero-rol').textContent =
        t.propietario_id === perfilActual.id_usuarios ? 'Propietario' : 'Colaborador';
      tarjeta.querySelector('.tablero-abrir').href = `tablero.html?id=${t.id}`;
      lista.appendChild(tarjeta);
    });
  } catch (err) {
    $('#tableros-cargando').hidden = true;
    mostrarMensaje(err.message, true);
  }
}

// Esta línea debe quedar al FINAL del archivo, después de declarar todo lo anterior
if ($('#menu-usuario')) cargaPagina();