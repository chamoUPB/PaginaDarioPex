// Historial de deshacer / rehacer (solo en memoria: se pierde al recargar la página)
const LIMITE = 100;
const pilaDeshacer = [];
const pilaRehacer = [];
let ocupado = false;
let alCambiar = () => {};

export function iniciarHistorial(callback) { alCambiar = callback; }
export const puedeDeshacer = () => pilaDeshacer.length > 0;
export const puedeRehacer = () => pilaRehacer.length > 0;

// accion = { nombre, deshacer: async () => {...}, rehacer: async () => {...} }
export function registrar(accion) {
  pilaDeshacer.push(accion);
  if (pilaDeshacer.length > LIMITE) pilaDeshacer.shift();
  pilaRehacer.length = 0;                  // una acción nueva borra lo que se podía rehacer
  alCambiar();
}

export function limpiar() {
  pilaDeshacer.length = 0;
  pilaRehacer.length = 0;
  alCambiar();
}

export async function deshacerUltimo() {
  if (ocupado || !pilaDeshacer.length) return null;
  const accion = pilaDeshacer.pop();
  ocupado = true;
  try {
    await accion.deshacer();
    pilaRehacer.push(accion);
    return accion;
  } catch (err) {
    limpiar();                             // si algo falla, el historial ya no es fiable
    throw err;
  } finally {
    ocupado = false;
    alCambiar();
  }
}

export async function rehacerUltimo() {
  if (ocupado || !pilaRehacer.length) return null;
  const accion = pilaRehacer.pop();
  ocupado = true;
  try {
    await accion.rehacer();
    pilaDeshacer.push(accion);
    return accion;
  } catch (err) {
    limpiar();
    throw err;
  } finally {
    ocupado = false;
    alCambiar();
  }
}