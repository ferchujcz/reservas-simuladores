import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkConnection, getTimezone, validateEnv, pool } from './config/db.js';

// Importar rutas
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import reservationRoutes from './routes/reservations.js';

// Cargar variables de entorno
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Ocultar firma de tecnología del servidor
app.disable('x-powered-by');

// Confiar en proxy reverso cuando esté en producción detrás de Nginx/Caddy (necesario para cookies secure)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middlewares
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(cookieParser());

// Cabeceras de seguridad HTTP y control de origen
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
  );

  // Configuración estricta de CORS si se especifica ALLOWED_ORIGIN
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin && req.headers.origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Rutas de API
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reservations', reservationRoutes);

// Health check
app.get('/health', async (_req, res) => {
  const ok = await checkConnection();
  const tz = ok ? await getTimezone() : (process.env.DB_TIMEZONE || 'UTC');
  res.status(ok ? 200 : 503).json({
    status: ok ? 'healthy' : 'unhealthy',
    timezone: tz,
  });
});

// Servir archivos estáticos de la interfaz (página pública y panel admin)
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// Fallback para rutas API inexistentes
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Endpoint de API no encontrado' });
});

// Error handler global (sin exponer secretos ni trazas internas al cliente)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Formato JSON inválido en la solicitud' });
  }
  console.error('Error no capturado:', err?.message || err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Arranque controlado del servidor: verifica variables y PostgreSQL ANTES de anunciar que está listo
export async function startServer(port = PORT) {
  if (!validateEnv()) {
    console.error('Fallo en la validación de configuración inicial. Abortando inicio.');
    process.exit(1);
  }

  try {
    const ok = await checkConnection();
    if (!ok) {
      console.error('Error crítico: PostgreSQL no está disponible. El servidor no puede iniciar.');
      process.exit(1);
    }

    const tz = await getTimezone();
    const server = app.listen(port, () => {
      console.log(`Servidor corriendo en http://localhost:${port}`);
      console.log(`Modo: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Zona horaria configurada: ${tz}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Error: El puerto ${port} ya está en uso por otro proceso. Cerrá el proceso anterior o cambiá PORT en .env.`);
      } else {
        console.error('Error en el servidor HTTP:', err.message);
      }
      process.exit(1);
    });

    // Cierre ordenado (graceful shutdown)
    const shutdown = async (signal) => {
      console.log(`\nRecibida señal ${signal}. Cerrando servidor y conexiones a PostgreSQL...`);
      server.close(async () => {
        try {
          await pool.end();
          console.log('Conexiones cerradas correctamente.');
          process.exit(0);
        } catch (err) {
          console.error('Error al cerrar pool de PostgreSQL:', err.message);
          process.exit(1);
        }
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    return server;
  } catch (e) {
    console.error('Error fatal al iniciar el servidor:', e.message);
    process.exit(1);
  }
}

// Ejecutar automáticamente si se invoca directamente (`npm start` / `node src/index.js`)
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  startServer();
}

export { app };
export default app;