# Progreso

## Estado

Implementación completa de backend, seguridad, página pública y panel administrativo.

## Trabajo realizado

- [x] Corrección del arranque y conexión a PostgreSQL en `src/config/db.js` y `src/index.js`: resolución del error `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` garantizando que la contraseña sea siempre un `string` válido tanto con `DATABASE_URL` como con variables separadas, validando variables obligatorias al iniciar y verificando PostgreSQL antes de anunciar que el servidor está listo.
- [x] Seguridad y lógica de negocio reforzadas:
  - Firma real HMAC-SHA256 con comparación en tiempo constante (`crypto.timingSafeEqual`) en `src/middleware/auth.js`.
  - Protección CSRF (`X-CSRF-Token` y validación de `Origin`/`Referer`) y rate limiter contra fuerza bruta en `/api/auth/login`.
  - Protección estricta de `/api/admin/*` y de las rutas de mutación de estado (`PUT /api/reservations/:id/confirm`, `PUT /api/reservations/:id/reject`, `DELETE /api/reservations/:id`).
  - Confirmación atómica con `SELECT ... FOR UPDATE` dentro de transacción SQL y manejo explícito de colisiones concurrentes (`23P01`).
- [x] Rediseño integral con identidad **Victory Simulator** (estética Motorsport SaaS inspirada en F1 Arcade y Racing Unleashed) y arquitectura frontend completamente separada (`public/assets/css/theme.css`, `booking.css`, `admin.css`, `public/assets/js/booking.js`, `admin.js`).
- [x] Blindaje de producción adicional: CSP estricto sin `unsafe-inline`, `Permissions-Policy`, ocultación de `X-Powered-By`, rate-limiting en creación pública de reservas, rechazo server-side de fechas pasadas y >90 días, y modal de confirmación para acciones destructivas en el Command Center.
- [x] Suite de verificación automatizada (`src/test/verifyAll.js` ejecutable con `npm test`) y limpieza de credenciales en archivos del repositorio.

## Instrucciones para desarrollo y producción

- **Desarrollo**:
  1. Copiar `.env.example` a `.env` y configurar la conexión a PostgreSQL.
  2. Asegurarse de que el servicio PostgreSQL esté corriendo en `DB_HOST:DB_PORT`.
  3. Ejecutar `npm start` (o `npm run dev`).
  4. Ejecutar pruebas con `npm test` (apuntando exclusivamente a `reservas_test`).
- **Producción (pasos pendientes antes de publicar)**:
  1. Iniciar el servicio PostgreSQL 16+ en el servidor de destino y aplicar `migrations/001_create_users_zones_reservations.sql` sobre `reservas_gaming`.
  2. Definir `NODE_ENV=production`, `COOKIE_SECRET` criptográficamente aleatorio (mínimo 32 bytes) y credenciales reales en `.env`.
  3. Configurar proxy reverso con HTTPS (Nginx o Caddy) hacia el puerto de Node.js (`trust proxy` ya está activo en modo `production` para cookies `secure`).
  4. Crear la primera cuenta administradora mediante `POST /api/auth/register` (se bloquea automáticamente tras existir el primer admin).
