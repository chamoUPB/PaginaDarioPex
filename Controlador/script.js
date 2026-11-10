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
    e.preventDefault();   // evita que la página se recargue y que los datos aparezcan en la URL

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

  // Si ya tiene sesión abierta, no hace falta volver a entrar
  Usuario.sesionActual().then((s) => { if (s) location.href = 'contenido.html'; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();   // evita que la página se recargue y que la contraseña aparezca en la URL

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
const SECCIONES = ['inicio', 'perfil', 'editar', 'tableros'];
let perfilActual = null;

async function cargaPagina() {
  const sesion = await Usuario.sesionActual();
  if (!sesion) {                              // sin sesión válida: de vuelta al inicio de sesión
    location.href = 'inicioseccion.html';
    return;
  }

  try {
    perfilActual = await Usuario.obtenerPerfil(sesion.user.id);
  } catch (err) {
    console.error(err.message);
    await Usuario.cerrarSesion();
    location.href = 'inicioseccion.html';
    return;
  }

  pintarPerfil();
  activarMenu();
  activarEdicion();
  activarSalir();
  activarTableros();
}

function iniciales(nombre) {
  return (nombre ?? '?').slice(0, 2).toUpperCase();
}

// Rellena todos los datos del usuario en la página
function pintarPerfil() {
  const p = perfilActual;
  $('#nombre-navbar').textContent = p.nombre_usuario;
  $('#avatar').textContent = iniciales(p.nombre_usuario);
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
  irA(location.hash.slice(1) || 'inicio');   // abre la sección indicada en la dirección (#perfil, etc.)
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
      // Solo se verifica si el nombre cambió (el propio nombre siempre figura como "ocupado")
      if (nombre.toLowerCase() !== perfilActual.nombre_usuario.toLowerCase()
          && !(await Usuario.nombreDisponible(nombre))) {
        throw new Error('Ese nombre de usuario ya está en uso');
      }

      perfilActual = await Usuario.actualizarPerfil(perfilActual.id_usuarios, {
        nombre_usuario: nombre,
        telefono,
      });
      pintarPerfil();                       // refresca los textos de la página
      irA('perfil');
      mostrarMensaje('Perfil actualizado correctamente');
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
      location.href = `tablero.html?id=${t.id}`;   // lo lleva directo al tablero nuevo
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
      tarjeta.querySelector('.tablero-nombre').textContent = t.nombre;   // textContent evita inyección de HTML
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