import bcrypt from 'bcrypt';
import { query } from '../config/db.js';

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);

// Hash de contraseña con bcrypt
export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// Verificar contraseña
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Crear usuario (solo admin)
export async function createUser({ email, password, nombre, rol }) {
  const passwordHash = await hashPassword(password);

  const result = await query(
    `INSERT INTO usuarios (email, password_hash, nombre, rol)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, nombre, rol, creado_en`,
    [email, passwordHash, nombre, rol]
  );

  return result.rows[0];
}

// Inicio de sesión
export async function login({ email, password }) {
  const result = await query(
    'SELECT id, email, nombre, rol, password_hash FROM usuarios WHERE email = $1',
    [email]
  );

  const user = result.rows[0];
  if (!user) {
    return null;
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return null;
  }

  // No devolver el hash
  const { password_hash, ...userSafe } = user;
  return userSafe;
}

// Verificar que un usuario es admin
export async function isAdmin(userId) {
  const result = await query(
    'SELECT rol FROM usuarios WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.rol === 'admin';
}