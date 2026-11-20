// Validación de datos en el servidor

const ERROR_MESSAGES = {
  email: 'El email es requerido y debe ser válido.',
  password: 'La contraseña es requerida y debe tener al menos 8 caracteres.',
  nombre: 'El nombre es requerido.',
  zonaId: 'El ID de zona es requerido y debe ser entero.',
  start: 'La fecha de inicio es requerida.',
  end: 'La fecha de fin es requerida.',
  range: 'La fecha de inicio debe ser anterior a la fecha de fin.',
  estado: 'Estado de reserva inválido.',
};

function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  // Regex sencilla y segura
  const re = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  return re.test(email);
}

function validatePassword(password) {
  return password && typeof password === 'string' && password.length >= 8;
}

function validateNombre(nombre) {
  return nombre && typeof nombre === 'string' && nombre.trim().length > 0;
}

function validateInteger(value) {
  return Number.isInteger(Number(value));
}

function validateDateTime(dt) {
  if (!dt) return false;
  const date = new Date(dt);
  return !isNaN(date.getTime());
}

function validateRange(start, end) {
  if (!validateDateTime(start) || !validateDateTime(end)) {
    return false;
  }
  return new Date(start).getTime() < new Date(end).getTime();
}

function validateEstado(estado) {
  return ['pendiente', 'confirmada', 'rechazada', 'cancelada', 'expirada'].includes(estado);
}

export {
  validateEmail,
  validatePassword,
  validateNombre,
  validateInteger,
  validateDateTime,
  validateRange,
  validateEstado,
  ERROR_MESSAGES,
};