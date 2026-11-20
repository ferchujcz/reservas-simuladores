import crypto from 'crypto';
import dotenv from 'dotenv';
import { query } from '../config/db.js';

dotenv.config();

// Obtener clave secreta segura para firmar tokens y CSRF
function getSecret() {
  const secret = process.env.COOKIE_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('COOKIE_SECRET no configurado o demasiado corto');
  }
  return secret;
}

// Comparación en tiempo constante para evitar ataques de timing
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Generar token de sesión firmado con HMAC-SHA256
export function generateSessionToken(userId, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = parseInt(process.env.SESSION_TTL_SECONDS || '3600', 10);
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const payload = {
    sub: userId,
    rol: extra.rol || undefined,
    csrf: csrfToken,
    iat: now,
    exp: now + ttl,
  };
  const secret = getSecret();
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${signature}`;
}

// Verificar token de sesión con HMAC-SHA256
export async function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;

    // Soporte para formato base64url (payloadB64.signature)
    let parts = token.split('.');
    let payloadStr;
    let signature;
    let signedData;

    if (parts.length === 2) {
      signedData = parts[0];
      signature = parts[1];
      const expectedSig = crypto
        .createHmac('sha256', getSecret())
        .update(signedData)
        .digest('base64url');
      if (!safeCompare(signature, expectedSig)) return null;
      payloadStr = Buffer.from(signedData, 'base64url').toString('utf8');
    } else {
      return null;
    }

    const payload = JSON.parse(payloadStr);
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

// Middleware: verificar sesión (token en cookie httpOnly) y cargar usuario real
export async function authMiddleware(req, res, next) {
  const token = req.cookies?.session;

  if (!token) {
    return res.status(401).json({
      error: 'Acceso no autorizado: sesión no encontrada',
    });
  }

  try {
    const payload = await verifyToken(token);
    if (!payload || !payload.sub) {
      return res.status(401).json({
        error: 'Sesión inválida o expirada',
      });
    }

    const result = await query(
      'SELECT id, email, nombre, rol FROM usuarios WHERE id = $1',
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({
        error: 'Usuario de la sesión no encontrado',
      });
    }

    req.user = user;
    req.csrfToken = payload.csrf;
    next();
  } catch {
    return res.status(401).json({
      error: 'Sesión inválida o expirada',
    });
  }
}

// Middleware: solo usuarios con rol admin
export function adminMiddleware(req, res, next) {
  if (!req.user || req.user.rol !== 'admin') {
    return res.status(403).json({
      error: 'Acceso prohibido: se requiere rol de administrador',
    });
  }
  next();
}

// Middleware: protección CSRF y validación de origen para peticiones que mutan estado
export function csrfOriginMiddleware(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // 1. Validar Origin o Referer si están presentes (defensa en profundidad)
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return res.status(403).json({ error: 'Origen de solicitud no permitido (CSRF)' });
      }
    } catch {
      return res.status(403).json({ error: 'Encabezado Origin inválido' });
    }
  } else if (referer && host) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost !== host) {
        return res.status(403).json({ error: 'Referer de solicitud no permitido (CSRF)' });
      }
    } catch {
      return res.status(403).json({ error: 'Encabezado Referer inválido' });
    }
  }

  // 2. Si el usuario tiene sesión autenticada y el cliente envía X-CSRF-Token, validarlo;
  //    o exigir Content-Type application/json en peticiones de API (no enviable por form HTML simple)
  const contentType = req.headers['content-type'] || '';
  const hasJsonHeader = contentType.includes('application/json');
  const csrfHeader = req.headers['x-csrf-token'];

  if (req.csrfToken && csrfHeader && !safeCompare(String(csrfHeader), String(req.csrfToken))) {
    return res.status(403).json({ error: 'Token CSRF inválido' });
  }

  // Para endpoints que mutan con cuerpo, exigir application/json o token CSRF válido
  if (req.cookies?.session && !hasJsonHeader && !csrfHeader) {
    return res.status(403).json({ error: 'Solicitud bloqueada por protección CSRF (se requiere JSON o X-CSRF-Token)' });
  }

  next();
}

// Rate limiter en memoria para proteger inicio de sesión contra fuerza bruta
const loginAttempts = new Map();
const MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10);
const WINDOW_MS = parseInt(process.env.LOGIN_WINDOW_MS || String(15 * 60 * 1000), 10);

export function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const emailKey = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const key = `${ip}:${emailKey}`;
  const now = Date.now();

  const record = loginAttempts.get(key);
  if (record) {
    if (now - record.firstAttempt > WINDOW_MS) {
      loginAttempts.delete(key);
    } else if (record.count >= MAX_ATTEMPTS) {
      const retryAfterSec = Math.ceil((WINDOW_MS - (now - record.firstAttempt)) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: `Demasiados intentos de inicio de sesión. Intente nuevamente en ${Math.ceil(retryAfterSec / 60)} minuto(s).`,
      });
    }
  }
  next();
}

export function recordLoginFailure(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const emailKey = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const key = `${ip}:${emailKey}`;
  const now = Date.now();

  const record = loginAttempts.get(key);
  if (!record || now - record.firstAttempt > WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAttempt: now });
  } else {
    record.count += 1;
  }
}

export function clearLoginFailures(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const emailKey = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const key = `${ip}:${emailKey}`;
  loginAttempts.delete(key);
}

export function resetAllLoginAttempts() {
  loginAttempts.clear();
}

// Rate limiter en memoria para proteger creación pública de reservas contra spam/abuso
const reservationAttempts = new Map();
const RES_MAX_ATTEMPTS = parseInt(process.env.RESERVATION_MAX_ATTEMPTS || '20', 10);
const RES_WINDOW_MS = parseInt(process.env.RESERVATION_WINDOW_MS || String(15 * 60 * 1000), 10);

export function reservationRateLimiter(req, res, next) {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const record = reservationAttempts.get(ip);

  if (!record || now - record.firstAttempt > RES_WINDOW_MS) {
    reservationAttempts.set(ip, { count: 1, firstAttempt: now });
    return next();
  }

  if (record.count >= RES_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((RES_WINDOW_MS - (now - record.firstAttempt)) / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: `Demasiadas solicitudes de reserva desde esta conexión. Intentá nuevamente en ${Math.ceil(retryAfterSec / 60)} minuto(s).`,
    });
  }

  record.count += 1;
  next();
}

export function resetReservationRateLimits() {
  reservationAttempts.clear();
}