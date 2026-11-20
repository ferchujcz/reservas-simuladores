// Suite de Verificación Integral — Reservas Gaming
// Ejecuta las 8 pruebas mínimas indispensables sobre `reservas_test` (si PostgreSQL está activo)
// y verifica toda la capa HTTP, autenticación, CSRF, rate-limit y validaciones.

import request from 'supertest';
import app from '../index.js';
import { pool, checkConnection, validateEnv, buildPoolConfig, isPgliteMode } from '../config/db.js';
import { createUser, hashPassword, verifyPassword } from '../services/authService.js';
import { resetAllLoginAttempts } from '../middleware/auth.js';

let passed = 0;
let failed = 0;
let skippedDb = 0;

function report(name, status, detail = '') {
  const icon = status === 'PASS' ? 'PASS' : status === 'SKIP_DB' ? 'SKIP (DB Offline)' : 'FAIL';
  console.log(`[${icon}] ${name}${detail ? ' — ' + detail : ''}`);
  if (status === 'PASS') passed++;
  else if (status === 'SKIP_DB') skippedDb++;
  else failed++;
}

async function runVerificationSuite() {
  console.log('==========================================================');
  console.log(' SUITE DE PRUEBAS INTEGRALES — RESERVAS GAMING');
  console.log('==========================================================\n');

  // --- 1. Arranque, Configuración y Conexión a PostgreSQL ---
  const envOk = validateEnv();
  const poolCfg = buildPoolConfig();
  const passIsString = typeof poolCfg.password === 'string' && poolCfg.password.length > 0;
  report(
    '1a. Configuración .env y password string válido para SCRAM (fix getTimezone)',
    envOk && passIsString ? 'PASS' : 'FAIL',
    `host=${poolCfg.host}:${poolCfg.port}, db=${poolCfg.database}, passwordType=${typeof poolCfg.password}`
  );

  // Seguridad: verificar que la base de datos configurada sea exclusivamente `reservas_test` o `pglite` local
  if (!isPgliteMode() && poolCfg.database !== 'reservas_test') {
    console.error(`ABORTANDO PRUEBAS: La base configurada es '${poolCfg.database}'. Las pruebas solo pueden ejecutarse contra 'reservas_test'.`);
    process.exit(1);
  }

  const dbOnline = await checkConnection();
  if (dbOnline) {
    const dbCheck = await pool.query('SELECT current_database() AS db');
    const currentDb = dbCheck.rows[0]?.db;
    const dbLabel = isPgliteMode() ? `pglite (${currentDb})` : currentDb;
    report(
      '1b. Conexión activa a PostgreSQL (reservas_test / pglite)',
      isPgliteMode() || currentDb === 'reservas_test' ? 'PASS' : 'FAIL',
      `Conectado a ${dbLabel}`
    );
  } else {
    report(
      '1b. Conexión activa a PostgreSQL (reservas_test)',
      'SKIP_DB',
      `No hay proceso PostgreSQL escuchando en ${poolCfg.host}:${poolCfg.port} (ECONNREFUSED). Healthcheck devuelve 503 correctamente.`
    );
  }

  const healthRes = await request(app).get('/health');
  report(
    '1c. Endpoint /health refleja estado real de PostgreSQL sin falsos positivos',
    (dbOnline && healthRes.status === 200 && healthRes.body.status === 'healthy') ||
      (!dbOnline && healthRes.status === 503 && healthRes.body.status === 'unhealthy')
      ? 'PASS'
      : 'FAIL',
    `HTTP ${healthRes.status} (${JSON.stringify(healthRes.body)})`
  );

  // --- 2. Bcrypt, Inicio de sesión válido/inválido y Fuerza Bruta ---
  resetAllLoginAttempts();
  const sampleHash = await hashPassword('ClaveSegura123!');
  const hashOk = await verifyPassword('ClaveSegura123!', sampleHash);
  const hashWrong = await verifyPassword('OtraClave999!', sampleHash);
  report(
    '2a. Hash de contraseñas con bcrypt y verificación segura',
    hashOk && !hashWrong ? 'PASS' : 'FAIL',
    'bcrypt.hash y bcrypt.compare verificados'
  );

  const badLoginFmt = await request(app)
    .post('/api/auth/login')
    .send({ email: 'correo-invalido', password: '123' });
  report(
    '2b. Rechazo de login con formato inválido (400)',
    badLoginFmt.status === 400 ? 'PASS' : 'FAIL',
    `HTTP ${badLoginFmt.status}: ${badLoginFmt.body.error}`
  );

  // Probar protección contra fuerza bruta (5 intentos fallidos -> 6to devuelve 429)
  resetAllLoginAttempts();
  for (let i = 0; i < 5; i++) {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'bruteforce@test.com', password: ' short ' });
  }
  const rateLimitedRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'bruteforce@test.com', password: ' short ' });
  report(
    '2c. Protección contra fuerza bruta en /api/auth/login (HTTP 429)',
    rateLimitedRes.status === 429 ? 'PASS' : 'FAIL',
    `HTTP ${rateLimitedRes.status}: ${rateLimitedRes.body.error}`
  );
  resetAllLoginAttempts();

  // --- 3. Acceso administrativo bloqueado sin autenticación ---
  const unauthZones = await request(app).get('/api/admin/zones');
  const unauthRes = await request(app).get('/api/admin/reservations');
  const unauthCreateZone = await request(app)
    .post('/api/admin/zones')
    .send({ nombre: 'Intruso', capacidad: 5 });
  const unauthConfirm = await request(app).put('/api/reservations/1/confirm');
  const unauthCancel = await request(app).delete('/api/reservations/1');

  const allAdminBlocked =
    unauthZones.status === 401 &&
    unauthRes.status === 401 &&
    unauthCreateZone.status === 401 &&
    unauthConfirm.status === 401 &&
    unauthCancel.status === 401;

  report(
    '3. Acceso administrativo bloqueado sin autenticación (zonas, reservas, confirmar, cancelar)',
    allAdminBlocked ? 'PASS' : 'FAIL',
    `Statuses: [${unauthZones.status}, ${unauthRes.status}, ${unauthCreateZone.status}, ${unauthConfirm.status}, ${unauthCancel.status}]`
  );

  // --- 8. Comprobación de errores principales de formularios, API y CSRF ---
  const badAvailZone = await request(app).get('/api/reservations/availability/abc?start=2026-12-01T10:00:00Z&end=2026-12-01T12:00:00Z');
  const badAvailRange = await request(app).get('/api/reservations/availability/1?start=2026-12-01T14:00:00Z&end=2026-12-01T10:00:00Z');
  const badCreateRange = await request(app)
    .post('/api/reservations')
    .send({ zoneId: 1, start: '2026-12-01T15:00:00Z', end: '2026-12-01T14:00:00Z', nombre: 'Test' });
  const pastCreate = await request(app)
    .post('/api/reservations')
    .send({ zoneId: 1, start: '2020-01-01T10:00:00Z', end: '2020-01-01T12:00:00Z', nombre: 'Test' });
  const badOriginCsrf = await request(app)
    .post('/api/reservations')
    .set('Origin', 'https://sitio-malicioso.evil.com')
    .set('Host', 'localhost:3000')
    .send({ zoneId: 1, start: '2027-01-01T10:00:00Z', end: '2027-01-01T12:00:00Z', nombre: 'Test' });

  const validationsOk =
    badAvailZone.status === 400 &&
    badAvailRange.status === 400 &&
    badCreateRange.status === 400 &&
    pastCreate.status === 400 &&
    badOriginCsrf.status === 403;

  report(
    '8a. Validaciones de formularios/API, rechazo de fechas pasadas y bloqueo CSRF por Origin cruzado',
    validationsOk ? 'PASS' : 'FAIL',
    `Statuses: [zonaInv=${badAvailZone.status}, rangoInv=${badAvailRange.status}, crearRangoInv=${badCreateRange.status}, pasado=${pastCreate.status}, csrfOrigin=${badOriginCsrf.status}]`
  );

  // Verificar activos estáticos separados y cabeceras de seguridad estrictas (CSP sin unsafe-inline)
  const homeRes = await request(app).get('/');
  const adminRes = await request(app).get('/admin/');
  const cssRes = await request(app).get('/assets/css/theme.css');
  const bookingJsRes = await request(app).get('/assets/js/booking.js');
  const adminJsRes = await request(app).get('/assets/js/admin.js');
  const cspHeader = homeRes.headers['content-security-policy'] || '';
  const strictCspOk = cspHeader.includes("script-src 'self'") && !cspHeader.includes("'unsafe-inline'");
  const assetsOk =
    homeRes.status === 200 &&
    homeRes.text.includes('Victory') &&
    adminRes.status === 200 &&
    cssRes.status === 200 &&
    bookingJsRes.status === 200 &&
    adminJsRes.status === 200 &&
    strictCspOk &&
    !homeRes.headers['x-powered-by'];

  report(
    '8b. Interfaz Victory Simulator separada (HTML/CSS/JS), CSP estricto y sin X-Powered-By',
    assetsOk ? 'PASS' : 'FAIL',
    `Statuses: [home=${homeRes.status}, admin=${adminRes.status}, css=${cssRes.status}, bookingJs=${bookingJsRes.status}, adminJs=${adminJsRes.status}], strictCSP=${strictCspOk}`
  );

  // --- Pruebas con Base de Datos (2d, 4, 5, 6, 7) sobre reservas_test ---
  if (!dbOnline) {
    report('2d. Login válido e inválido contra BD', 'SKIP_DB', 'Requiere servicio PostgreSQL activo');
    report('4. Consulta pública de disponibilidad y zonas', 'SKIP_DB', 'Requiere servicio PostgreSQL activo');
    report('5. Creación de una reserva válida', 'SKIP_DB', 'Requiere servicio PostgreSQL activo');
    report('6. Rechazo de reservas superpuestas y concurrentes', 'SKIP_DB', 'Requiere servicio PostgreSQL activo');
    report('7. Confirmación y cancelación de reservas liberando horario', 'SKIP_DB', 'Requiere servicio PostgreSQL activo');
  } else {
    // Preparar admin y zona de prueba en reservas_test
    const testEmail = 'admin_suite@test.local';
    const testPass = 'AdminSuitePass123!';
    await pool.query('DELETE FROM usuarios WHERE email = $1', [testEmail]);
    await createUser({ email: testEmail, password: testPass, nombre: 'Admin Suite', rol: 'admin' });

    const wrongPassRes = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'WrongPassword123!' });

    const goodLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: testPass });

    const cookies = goodLoginRes.headers['set-cookie'];
    const csrfToken = goodLoginRes.body.csrfToken;

    report(
      '2d. Login válido (200 + cookie httpOnly) e inválido (401)',
      wrongPassRes.status === 401 && goodLoginRes.status === 200 && Boolean(cookies) ? 'PASS' : 'FAIL',
      `wrong=${wrongPassRes.status}, valid=${goodLoginRes.status}`
    );

    // Crear zona de prueba vía endpoint admin autenticado
    const createZoneRes = await request(app)
      .post('/api/admin/zones')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken)
      .send({ nombre: 'Zona Test Suite', descripcion: '5 PCs Pro', capacidad: 5, active: true });

    const testZoneId = createZoneRes.body.zone?.id;

    // Fecha dinámica válida (mañana) para no depender del calendario ni superar el límite de 90 días
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const dayStr = `${yyyy}-${mm}-${dd}`;

    // 4. Consulta pública de disponibilidad
    const pubZonesRes = await request(app).get('/api/reservations/zones');
    const availRes = await request(app).get(
      `/api/reservations/availability/${testZoneId}?start=${dayStr}T14:00:00-03:00&end=${dayStr}T16:00:00-03:00`
    );
    report(
      '4. Consulta pública de zonas y disponibilidad',
      pubZonesRes.status === 200 && availRes.status === 200 && availRes.body.available === true ? 'PASS' : 'FAIL',
      `zones=${pubZonesRes.body.zones?.length}, available=${availRes.body.available}`
    );

    // 5. Creación de una reserva válida
    const createRes = await request(app)
      .post('/api/reservations')
      .send({
        zoneId: testZoneId,
        start: `${dayStr}T14:00:00-03:00`,
        end: `${dayStr}T16:00:00-03:00`,
        nombre: 'Jugador Uno',
        contacto: 'jugador1@test.com',
        jugadores: 4,
      });
    const createdResId = createRes.body.reservation?.id;
    report(
      '5. Creación de una reserva válida',
      createRes.status === 201 && createdResId ? 'PASS' : 'FAIL',
      `ID=${createdResId}, estado=${createRes.body.reservation?.estado}`
    );

    // 6. Rechazo de reservas superpuestas, incluidas solicitudes concurrentes
    const overlapRes = await request(app)
      .post('/api/reservations')
      .send({
        zoneId: testZoneId,
        start: `${dayStr}T15:00:00-03:00`,
        end: `${dayStr}T17:00:00-03:00`,
        nombre: 'Jugador Solapado',
        contacto: 'overlap@test.com',
        jugadores: 2,
      });

    // Solicitudes simultáneas exactas para un nuevo horario [18:00, 20:00)
    const [conc1, conc2] = await Promise.all([
      request(app).post('/api/reservations').send({
        zoneId: testZoneId,
        start: `${dayStr}T18:00:00-03:00`,
        end: `${dayStr}T20:00:00-03:00`,
        nombre: 'Concurrente A',
        contacto: 'a@test.com',
        jugadores: 2,
      }),
      request(app).post('/api/reservations').send({
        zoneId: testZoneId,
        start: `${dayStr}T18:00:00-03:00`,
        end: `${dayStr}T20:00:00-03:00`,
        nombre: 'Concurrente B',
        contacto: 'b@test.com',
        jugadores: 2,
      }),
    ]);
    const statuses = [conc1.status, conc2.status].sort();
    report(
      '6. Rechazo de reservas superpuestas y solicitudes concurrentes (201 + 409)',
      overlapRes.status === 409 && statuses[0] === 201 && statuses[1] === 409 ? 'PASS' : 'FAIL',
      `overlap=${overlapRes.status}, concurrentes=[${statuses.join(', ')}]`
    );

    // 7. Confirmación y cancelación de reservas
    const confirmRes = await request(app)
      .put(`/api/reservations/${createdResId}/confirm`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken);

    const cancelRes = await request(app)
      .delete(`/api/reservations/${createdResId}`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfToken);

    const availAfterCancel = await request(app).get(
      `/api/reservations/availability/${testZoneId}?start=${dayStr}T14:00:00-03:00&end=${dayStr}T16:00:00-03:00`
    );

    report(
      '7. Confirmación y cancelación de reserva liberando el horario',
      confirmRes.status === 200 &&
        cancelRes.status === 200 &&
        availAfterCancel.body.available === true
        ? 'PASS'
        : 'FAIL',
      `confirm=${confirmRes.status}, cancel=${cancelRes.status}, disponiblePostCancel=${availAfterCancel.body.available}`
    );

    // Limpieza de datos creados por la suite en reservas_test
    await pool.query('DELETE FROM reservas WHERE zona_id = $1', [testZoneId]);
    await pool.query('DELETE FROM zonas WHERE id = $1', [testZoneId]);
    await pool.query('DELETE FROM usuarios WHERE email = $1', [testEmail]);
  }

  console.log('\n==========================================================');
  console.log(` RESUMEN: ${passed} aprobadas | ${failed} fallidas | ${skippedDb} omitidas por PostgreSQL apagado`);
  console.log('==========================================================');

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runVerificationSuite().catch(async (err) => {
  console.error('Error inesperado en suite de pruebas:', err);
  await pool.end();
  process.exit(1);
});
