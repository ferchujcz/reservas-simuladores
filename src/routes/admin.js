import { Router } from 'express';
import { authMiddleware, adminMiddleware, csrfOriginMiddleware } from '../middleware/auth.js';
import {
  listZones,
  createZone,
  updateZone,
  getZoneById,
  listReservations,
  getReservationsSummary,
  checkAvailability,
  createReservation,
  rescheduleReservation,
  expirePendingReservations,
} from '../services/reservationService.js';
import {
  getBusinessSettings,
  updateBusinessSettings,
  validateBusinessHours,
} from '../services/settingsService.js';
import {
  validateInteger,
  validateNombre,
  validateEstado,
  validateDateTime,
  validateRange,
  ERROR_MESSAGES,
} from '../validators.js';
import { query, getTimezone } from '../config/db.js';

const router = Router();

// TODOS los endpoints de /api/admin requieren autenticación y rol de administrador
router.use(authMiddleware, adminMiddleware, csrfOriginMiddleware);

// GET /api/admin/summary - Resumen estadístico para el dashboard administrativo
router.get('/summary', async (_req, res) => {
  try {
    const summary = await getReservationsSummary();
    res.json(summary);
  } catch (e) {
    console.error('Admin summary error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/admin/zones - Listar todas las zonas (activas e inactivas)
router.get('/zones', async (_req, res) => {
  try {
    const zones = await listZones({ onlyActive: false });
    res.json({ zones });
  } catch (e) {
    console.error('List zones error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/admin/zones - Crear zona
router.post('/zones', async (req, res) => {
  try {
    const { nombre, descripcion, capacidad, active = true } = req.body;

    if (!validateNombre(nombre)) {
      return res.status(400).json({ error: ERROR_MESSAGES.nombre });
    }
    if (!validateInteger(capacidad) || parseInt(capacidad, 10) <= 0) {
      return res.status(400).json({ error: 'La capacidad debe ser un entero positivo' });
    }

    const zone = await createZone({
      nombre: nombre.trim(),
      descripcion: descripcion ? String(descripcion).trim() : null,
      capacidad: parseInt(capacidad, 10),
      active: Boolean(active),
    });

    res.status(201).json({ message: 'Zona creada', zone });
  } catch (e) {
    console.error('Create zone error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/admin/zones/:id - Editar o activar/desactivar zona
router.put('/zones/:id', async (req, res) => {
  try {
    const zoneId = parseInt(req.params.id, 10);
    if (!validateInteger(zoneId)) {
      return res.status(400).json({ error: ERROR_MESSAGES.zonaId });
    }

    const { nombre, descripcion, capacidad, active } = req.body;

    if (nombre !== undefined && !validateNombre(nombre)) {
      return res.status(400).json({ error: ERROR_MESSAGES.nombre });
    }
    if (capacidad !== undefined && (!validateInteger(capacidad) || parseInt(capacidad, 10) <= 0)) {
      return res.status(400).json({ error: 'La capacidad debe ser un entero positivo' });
    }

    const updated = await updateZone(zoneId, {
      nombre: nombre !== undefined ? String(nombre).trim() : undefined,
      descripcion: descripcion !== undefined ? (descripcion ? String(descripcion).trim() : null) : undefined,
      capacidad: capacidad !== undefined ? parseInt(capacidad, 10) : undefined,
      active: active !== undefined ? Boolean(active) : undefined,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Zona no encontrada' });
    }

    res.json({ message: 'Zona actualizada', zone: updated });
  } catch (e) {
    console.error('Update zone error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/admin/reservations - Listar reservas con filtros opcionales (zoneId, estado, date)
router.get('/reservations', async (req, res) => {
  try {
    const { zoneId, estado, date } = req.query;

    if (zoneId !== undefined && zoneId !== '' && !validateInteger(zoneId)) {
      return res.status(400).json({ error: ERROR_MESSAGES.zonaId });
    }
    if (estado !== undefined && estado !== '' && !validateEstado(estado)) {
      return res.status(400).json({ error: ERROR_MESSAGES.estado });
    }
    if (date !== undefined && date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: 'Formato de fecha inválido (use YYYY-MM-DD)' });
    }

    const reservations = await listReservations({
      zoneId: zoneId ? parseInt(zoneId, 10) : undefined,
      estado: estado || undefined,
      date: date || undefined,
    });
    res.json({ reservations });
  } catch (e) {
    console.error('List reservations error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/admin/reservations - Crear turno manualmente desde administración (ej. WhatsApp / presencial)
router.post('/reservations', async (req, res) => {
  try {
    const {
      zoneId,
      start,
      end,
      nombre,
      contacto,
      jugadores,
      notas,
      estado = 'confirmada',
    } = req.body;

    if (!validateInteger(zoneId)) {
      return res.status(400).json({ error: ERROR_MESSAGES.zonaId });
    }
    if (!validateDateTime(start) || !validateDateTime(end)) {
      return res.status(400).json({ error: 'Fechas inválidas' });
    }
    if (!validateRange(start, end)) {
      return res.status(400).json({ error: ERROR_MESSAGES.range });
    }
    if (!['pendiente', 'confirmada'].includes(estado)) {
      return res.status(400).json({ error: 'El estado inicial debe ser pendiente o confirmada' });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    const durationMinutes = (endDate.getTime() - startDate.getTime()) / (1000 * 60);
    if (durationMinutes < 30 || durationMinutes > 720) {
      return res.status(400).json({ error: 'La duración debe ser de entre 30 minutos y 12 horas' });
    }

    const settings = await getBusinessSettings();
    const tz = await getTimezone();
    const hoursCheck = validateBusinessHours(settings, startDate, endDate, tz);
    if (!hoursCheck.ok) {
      return res.status(400).json({ error: hoursCheck.error });
    }

    const zone = await getZoneById(parseInt(zoneId, 10));
    if (!zone) {
      return res.status(404).json({ error: 'Simulador / Zona no encontrado' });
    }

    if (jugadores !== undefined && jugadores !== null && jugadores !== '') {
      const num = parseInt(jugadores, 10);
      if (!validateInteger(num) || num <= 0 || num > zone.capacidad) {
        return res.status(400).json({
          error: `La cantidad de pilotos debe estar entre 1 y ${zone.capacidad}`,
        });
      }
    }

    const parts = [];
    if (nombre && String(nombre).trim()) parts.push(`Piloto: ${String(nombre).trim()}`);
    if (contacto && String(contacto).trim()) parts.push(`Contacto: ${String(contacto).trim()}`);
    if (jugadores) parts.push(`Pilotos: ${jugadores}`);
    if (notas && String(notas).trim()) parts.push(`Notas: ${String(notas).trim()}`);
    const finalNotas = parts.length > 0 ? `[Admin] ${parts.join(' | ')}` : '[Admin] Turno manual';

    await expirePendingReservations();

    const overlaps = await checkAvailability(parseInt(zoneId, 10), startDate, endDate);
    if (overlaps.length > 0) {
      return res.status(409).json({
        error: 'Ese horario ya está ocupado por otra reserva activa en este simulador.',
        conflicts: overlaps,
      });
    }

    const reservation = await createReservation({
      zoneId: parseInt(zoneId, 10),
      start: startDate,
      end: endDate,
      estado,
      notas: finalNotas.slice(0, 500),
      solicitadoPor: req.user.id,
    });

    if (estado === 'confirmada') {
      await query('UPDATE reservas SET confirmado_en = NOW() WHERE id = $1', [reservation.id]);
    }

    res.status(201).json({
      message: 'Turno creado correctamente',
      reservation: {
        ...reservation,
        zona_nombre: zone.nombre,
      },
    });
  } catch (e) {
    if (e.code === '23P01') {
      return res.status(409).json({
        error: 'Conflicto de horario: el bloque ya está ocupado.',
      });
    }
    console.error('Admin create reservation error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/admin/settings - Obtener configuración comercial (precios, descuentos, buffer, horarios)
router.get('/settings', async (_req, res) => {
  try {
    const settings = await getBusinessSettings();
    res.json({ settings });
  } catch (e) {
    console.error('Admin get settings error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/admin/settings - Actualizar configuración comercial
router.put('/settings', async (req, res) => {
  try {
    const updated = await updateBusinessSettings(req.body || {});
    res.json({ message: 'Configuración guardada correctamente', settings: updated });
  } catch (e) {
    console.error('Admin update settings error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/admin/reservations/:id/reschedule - Reprogramar turno activo
router.put('/reservations/:id/reschedule', async (req, res) => {
  try {
    const reservationId = parseInt(req.params.id, 10);
    const { zoneId, start, end } = req.body;

    if (!validateInteger(reservationId)) {
      return res.status(400).json({ error: 'ID de reserva inválido' });
    }
    if (zoneId !== undefined && zoneId !== '' && !validateInteger(zoneId)) {
      return res.status(400).json({ error: ERROR_MESSAGES.zonaId });
    }
    if (!validateDateTime(start) || !validateDateTime(end)) {
      return res.status(400).json({ error: 'Fechas inválidas' });
    }
    if (!validateRange(start, end)) {
      return res.status(400).json({ error: ERROR_MESSAGES.range });
    }

    await expirePendingReservations();

    const settings = await getBusinessSettings();
    const tz = await getTimezone();
    const hoursCheck = validateBusinessHours(settings, new Date(start), new Date(end), tz);
    if (!hoursCheck.ok) {
      return res.status(400).json({ error: hoursCheck.error });
    }

    const result = await rescheduleReservation(reservationId, {
      zoneId: zoneId ? parseInt(zoneId, 10) : undefined,
      start: new Date(start),
      end: new Date(end),
    });

    if (!result.ok) {
      const reasons = {
        not_found: 'Reserva no encontrada',
        not_active: 'Solo se pueden reprogramar reservas pendientes o confirmadas',
        conflict: 'El nuevo horario ya está ocupado en ese simulador',
        zone_not_found: 'Simulador destino no encontrado',
      };
      const status = result.reason === 'not_found' || result.reason === 'zone_not_found'
        ? 404
        : result.reason === 'conflict'
          ? 409
          : 400;
      return res.status(status).json({ error: reasons[result.reason] || 'No se pudo reprogramar' });
    }

    res.json({
      message: 'Turno reprogramado correctamente',
      reservation: result.reservation,
    });
  } catch (e) {
    console.error('Admin reschedule error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/admin/zones/:id/availability
router.get('/zones/:id/availability', async (req, res) => {
  try {
    const zoneId = parseInt(req.params.id, 10);
    if (!validateInteger(zoneId)) {
      return res.status(400).json({ error: ERROR_MESSAGES.zonaId });
    }

    const reservations = await listReservations({ zoneId });
    res.json({ zoneId, reservations });
  } catch (e) {
    console.error('Get availability error:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;