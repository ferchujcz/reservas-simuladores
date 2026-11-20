import { Router } from 'express';
import {
  createUser,
  login,
} from '../services/authService.js';
import {
  generateSessionToken,
  verifyToken,
  loginRateLimiter,
  recordLoginFailure,
  clearLoginFailures,
} from '../middleware/auth.js';
import {
  validateEmail,
  validatePassword,
  validateNombre,
  ERROR_MESSAGES,
} from '../validators.js';
import { query } from '../config/db.js';

const router = Router();

// POST /api/auth/register - Protegido: solo permite crear el primer admin si no existe ninguno,
// o requiere sesión activa de un administrador. No hay registro público libre.
router.post('/register', async (req, res) => {
  try {
    const { email, password, nombre, rol = 'admin' } = req.body;

    if (!validateEmail(email)) {
      return res.status(400).json({ error: ERROR_MESSAGES.email });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ error: ERROR_MESSAGES.password });
    }
    if (!validateNombre(nombre)) {
      return res.status(400).json({ error: ERROR_MESSAGES.nombre });
    }

    // Verificar si ya existe algún administrador en el sistema
    const adminCheck = await query("SELECT COUNT(*)::int AS count FROM usuarios WHERE rol = 'admin'");
    const hasAdmins = (adminCheck.rows[0]?.count || 0) > 0;

    if (hasAdmins) {
      // Si ya existe al menos un admin, exigir sesión de administrador autenticada
      const token = req.cookies?.session;
      const payload = token ? await verifyToken(token) : null;
      if (!payload || !payload.sub) {
        return res.status(403).json({
          error: 'El registro público está deshabilitado. Se requiere autenticación de administrador.',
        });
      }
      const callerRes = await query('SELECT rol FROM usuarios WHERE id = $1', [payload.sub]);
      if (callerRes.rows[0]?.rol !== 'admin') {
        return res.status(403).json({
          error: 'Se requiere rol de administrador para registrar nuevos usuarios.',
        });
      }
    }

    const validRol = ['admin', 'cliente'].includes(rol) ? rol : 'cliente';
    const user = await createUser({
      email: email.trim().toLowerCase(),
      password,
      nombre: nombre.trim(),
      rol: hasAdmins ? validRol : 'admin',
    });

    res.status(201).json({
      message: 'Usuario creado',
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      },
    });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/login
router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!validateEmail(email) || !validatePassword(password)) {
      recordLoginFailure(req);
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    const user = await login({ email: email.trim().toLowerCase(), password });

    if (!user) {
      recordLoginFailure(req);
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    clearLoginFailures(req);
    const token = generateSessionToken(user.id, { rol: user.rol });
    const decoded = await verifyToken(token);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: parseInt(process.env.SESSION_TTL_SECONDS || '3600', 10) * 1000,
      path: '/',
    };

    res.cookie('session', token, cookieOptions);
    res.json({
      message: 'Sesión iniciada',
      csrfToken: decoded?.csrf,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      },
    });
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.clearCookie('session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  res.json({ message: 'Sesión cerrada' });
});

// GET /api/auth/me - Obtener usuario actual
router.get('/me', async (req, res) => {
  try {
    const token = req.cookies?.session;
    if (!token) {
      return res.status(401).json({ error: 'No hay sesión activa' });
    }

    const payload = await verifyToken(token);
    if (!payload || !payload.sub) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const result = await query(
      'SELECT id, email, nombre, rol, creado_en FROM usuarios WHERE id = $1',
      [payload.sub]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    res.json({
      user: result.rows[0],
      csrfToken: payload.csrf,
    });
  } catch (e) {
    console.error('Auth/me error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;