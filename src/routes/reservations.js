import { Router } from 'express';
import {
  checkAvailability,
  createReservation,
  confirmReservation,
  rejectReservation,
  cancelReservation,
  expirePendingReservations,
  listZones,
  getZoneById,
} from '../services/reservationService.js';
import {
  authMiddleware,
  adminMiddleware,
  csrfOriginMiddleware,
  reservationRateLimiter,
} from '../middleware/auth.js';
import {
  getBusinessSettings,
  calculateReservationPrice,
} from '../services/settingsService.js';
import { query } from '../config/db.js';
import { validateInteger, validateDateTime, validateRange } from '../validators.js';

const router = Router();

// GET /api/reservations/status/:code - Consulta pública del estado de un turno (sin exponer datos privados)
router.get('/status/:code', async (req, res) => {
  try {
    const raw = String(req.params.code || '').trim().toUpperCase();
    const match = raw.match(/^(?:VS-)?0*(\d+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Código inválido. Usá el formato VS-0001 o el número de turno.' });
    }
    const id = parseInt(match[1], 10);

    await expirePendingReservations();

    const result = await query(
      `SELECT r.id,
              z.nombre AS zona_nombre,
              lower(r.rango) AS inicio,
              upper(r.rango) AS fin,
              r.estado
       FROM reservas r
       LEFT JOIN zonas z ON z.id = r.zona_id
       WHERE r.id = $1`,
      [id]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'No encontramos ningún turno con ese código.' });
    }

    res.json({
      reservation: {
        id: row.id,
        code: `VS-${String(row.id).padStart(4, '0')}`,
        zona_nombre: row.zona_nombre,
        inicio: row.inicio,
        fin: row.fin,
        estado: row.estado,
      },
    });
  } catch (e) {
    console.error('Status lookup error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/reservations/settings - Configuración pública (precios, descuentos, buffer y horarios)
router.get('/settings', async (_req, res) => {
  try {
    const settings = await getBusinessSettings();
    res.json({ settings });
  } catch (e) {
    console.error('Public settings error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/reservations/zones - Consultar públicamente las zonas activas disponibles
router.get('/zones', async (_req, res) => {
  try {
    const zones = await listZones({ onlyActive: true });
    res.json({ zones });
  } catch (e) {
    console.error('Public zones error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/reservations/availability/:zoneId?start=...&end=...
// Consultar disponibilidad de un rango en una zona
router.get('/availability/:zoneId', async (req, res) => {
  try {
    const zoneId = parseInt(req.params.zoneId, 10);
    const { start, end } = req.query;

    if (!validateInteger(zoneId)) {
      return res.status(400).json({ error: 'ID de zona inválido' });
    }
    if (!validateDateTime(start) || !validateDateTime(end)) {
      return res.status(400).json({ error: 'Fechas inválidas' });
    }
    if (!validateRange(start, end)) {
      return res.status(400).json({ error: 'La fecha de inicio debe ser anterior a la fecha de fin' });
    }

    // Expirar reservas pendientes vencidas antes de consultar
    await expirePendingReservations();

    const overlaps = await checkAvailability(
      zoneId,
      new Date(start),
      new Date(end)
    );

    // Exponer únicamente rangos ocupados sin datos privados de clientes
    const occupiedSlots = overlaps.map((r) => ({
      id: r.id,
      inicio: r.inicio,
      fin: r.fin,
      estado: r.estado,
    }));

    const available = occupiedSlots.length === 0;
    res.json({
      zoneId,
      start,
      end,
      available,
      conflicts: occupiedSlots,
    });
  } catch (e) {
    console.error('Availability error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/reservations
// Crear una nueva solicitud de reserva pública (validada en servidor y atómica con constraint GIST)
router.post('/', reservationRateLimiter, csrfOriginMiddleware, async (req, res) => {
  try {
    const { zoneId, start, end, notas, nombre, contacto, jugadores, solicitadoPor } = req.body;

    if (!validateInteger(zoneId)) {
      return res.status(400).json({ error: 'ID de zona inválido' });
    }
    if (!validateDateTime(start) || !validateDateTime(end)) {
      return res.status(400).json({ error: 'Fechas inválidas' });
    }
    if (!validateRange(start, end)) {
      return res.status(400).json({ error: 'La fecha de inicio debe ser anterior a la fecha de fin' });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    const nowMs = Date.now();

    // Rechazar reservas en el pasado (con 1 minuto de tolerancia por latencia)
    if (startDate.getTime() < nowMs - 60 * 1000) {
      return res.status(400).json({
        error: 'No se pueden crear reservas en un horario que ya pasó',
      });
    }

    // Rechazar reservas a más de 90 días
    const maxFutureMs = nowMs + 90 * 24 * 60 * 60 * 1000;
    if (startDate.getTime() > maxFutureMs) {
      return res.status(400).json({
        error: 'No se permiten reservas con más de 90 días de anticipación',
      });
    }

    const durationMinutes = (endDate.getTime() - startDate.getTime()) / (1000 * 60);

    if (durationMinutes < 30 || durationMinutes > 720) {
      return res.status(400).json({
        error: 'La duración de la reserva debe ser de entre 30 minutos y 12 horas',
      });
    }

    // Verificar que la zona exista y esté activa
    const zone = await getZoneById(parseInt(zoneId, 10));
    if (!zone) {
      return res.status(404).json({ error: 'Zona no encontrada' });
    }
    if (!zone.active) {
      return res.status(400).json({ error: 'La zona seleccionada no está disponible actualmente' });
    }

    if (jugadores !== undefined && jugadores !== null && jugadores !== '') {
      const numJugadores = parseInt(jugadores, 10);
      if (!validateInteger(numJugadores) || numJugadores <= 0 || numJugadores > zone.capacidad) {
        return res.status(400).json({
          error: `La cantidad de jugadores debe estar entre 1 y la capacidad máxima de la zona (${zone.capacidad})`,
        });
      }
    }

    // Calcular precio oficial en el servidor
    const settings = await getBusinessSettings();
    const pricing = calculateReservationPrice(settings, {
      zoneId: parseInt(zoneId, 10),
      durationMinutes,
      players: jugadores || 1,
    });

    // Construir nota estructurada con los datos del solicitante y cotización
    let finalNotas = notas ? String(notas).trim() : '';
    if (nombre && typeof nombre === 'string' && nombre.trim()) {
      const parts = [`Solicitante: ${nombre.trim()}`];
      if (contacto && String(contacto).trim()) parts.push(`Contacto: ${String(contacto).trim()}`);
      if (jugadores) parts.push(`Pilotos: ${jugadores}`);
      if (pricing.total > 0) parts.push(`Total est.: $${pricing.total.toLocaleString('es-AR')} ${pricing.currency}`);
      if (finalNotas) parts.push(`Notas: ${finalNotas}`);
      finalNotas = parts.join(' | ');
    }

    if (!finalNotas || finalNotas.length < 2) {
      return res.status(400).json({ error: 'Debe ingresar el nombre o datos del solicitante' });
    }
    if (finalNotas.length > 500) {
      return res.status(400).json({ error: 'Los datos ingresados exceden la longitud máxima permitida (500 caracteres)' });
    }

    // Expirar reservas pendientes vencidas antes de verificar disponibilidad
    await expirePendingReservations();

    // Verificar disponibilidad previa
    const overlaps = await checkAvailability(parseInt(zoneId, 10), startDate, endDate);
    if (overlaps.length > 0) {
      return res.status(409).json({
        error: 'El horario seleccionado acaba de ocuparse. Por favor elija otro horario.',
        conflicts: overlaps.map((r) => ({
          id: r.id,
          inicio: r.inicio,
          fin: r.fin,
          estado: r.estado,
        })),
      });
    }

    const reservation = await createReservation({
      zoneId: parseInt(zoneId, 10),
      start: startDate,
      end: endDate,
      estado: 'pendiente',
      notas: finalNotas,
      solicitadoPor: solicitadoPor || null,
    });

    res.status(201).json({
      message: 'Solicitud de reserva creada',
      pricing,
      reservation: {
        id: reservation.id,
        zona_id: reservation.zona_id,
        zona_nombre: zone.nombre,
        rango: reservation.rango,
        inicio: reservation.inicio,
        fin: reservation.fin,
        estado: reservation.estado,
        notas: reservation.notas,
        creado_en: reservation.creado_en,
      },
    });
  } catch (e) {
    if (e.code === '23P01') {
      // Captura de violación del constraint GIST ante solicitudes simultáneas
      return res.status(409).json({
        error: 'El horario seleccionado acaba de ocuparse por otra solicitud simultánea. Por favor elija otro horario.',
      });
    }
    if (e.code === '23503') {
      return res.status(404).json({ error: 'Zona no encontrada' });
    }
    console.error('Create reservation error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Las operaciones de gestión de estado de reservas requieren autenticación de administrador
// PUT /api/reservations/:id/confirm
router.put('/:id/confirm', authMiddleware, adminMiddleware, csrfOriginMiddleware, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);

    if (!validateInteger(reservationId)) {
      return res.status(400).json({ error: 'ID de reserva inválido' });
    }

    await expirePendingReservations();

    const result = await confirmReservation(reservationId);

    if (!result.ok) {
      const reasons = {
        not_found: 'Reserva no encontrada',
        not_pending: 'La reserva no está en estado pendiente',
        expired: 'La reserva está vencida',
        conflict: 'Conflicto de horario: el horario ya está ocupado',
      };
      const status = result.reason === 'not_found' ? 404 : result.reason === 'conflict' ? 409 : 400;
      return res.status(status).json({ error: reasons[result.reason] || 'Error desconocido' });
    }

    res.json({
      message: 'Reserva confirmada',
      reservation: result.reservation,
    });
  } catch (e) {
    console.error('Confirm reservation error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/reservations/:id/reject
router.put('/:id/reject', authMiddleware, adminMiddleware, csrfOriginMiddleware, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);

    if (!validateInteger(reservationId)) {
      return res.status(400).json({ error: 'ID de reserva inválido' });
    }

    const reservation = await rejectReservation(reservationId);

    if (!reservation) {
      return res.status(404).json({ error: 'Reserva no encontrada o no está pendiente' });
    }

    res.json({ message: 'Reserva rechazada', reservation });
  } catch (e) {
    console.error('Reject reservation error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/reservations/:id
router.delete('/:id', authMiddleware, adminMiddleware, csrfOriginMiddleware, async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);

    if (!validateInteger(reservationId)) {
      return res.status(400).json({ error: 'ID de reserva inválido' });
    }

    const reservation = await cancelReservation(reservationId);

    if (!reservation) {
      return res.status(404).json({
        error: 'Reserva no encontrada o no se puede cancelar',
      });
    }

    res.json({ message: 'Reserva cancelada y horario liberado', reservation });
  } catch (e) {
    console.error('Cancel reservation error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;