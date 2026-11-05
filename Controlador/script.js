import * as Usuario from '../Modelo/usuarioModel.js';

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