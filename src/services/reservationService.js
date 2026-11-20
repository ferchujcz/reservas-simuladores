import { query, pool, getTimezone } from '../config/db.js';

const EXPIRED = 'expirada';
const PENDING = 'pendiente';
const CONFIRMED = 'confirmada';
const REJECTED = 'rechazada';
const CANCELLED = 'cancelada';

// Ejecutar expiración on-demand de solicitudes pendientes vencidas.
// Marca como 'expirada' a las pendientes cuyo rango ya terminó o que superaron el límite de espera.
// No elimina historial; solo cambia estado.
export async function expirePendingReservations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expirySeconds = parseInt(process.env.REQUEST_EXPIRY_SECONDS || '0', 10);
    let result;
    if (expirySeconds > 0) {
      result = await client.query(
        `UPDATE reservas
         SET estado = 'expirada'
         WHERE estado = 'pendiente'
           AND (
             upper(rango) <= NOW()
             OR creado_en + ($1 * INTERVAL '1 second') <= NOW()
           )`,
        [expirySeconds]
      );
    } else {
      result = await client.query(
        `UPDATE reservas
         SET estado = 'expirada'
         WHERE estado = 'pendiente'
           AND upper(rango) <= NOW()`
      );
    }
    await client.query('COMMIT');
    return result.rowCount;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Verificar disponibilidad de un rango horario en una zona.
// Usa rangos semiabiertos [) -> no hay solapamiento con extremos en el mismo instante.
export async function checkAvailability(zoneId, start, end) {
  await getTimezone();

  const result = await query(
    `SELECT id,
            zona_id,
            rango,
            lower(rango) AS inicio,
            upper(rango) AS fin,
            estado,
            creado_en
     FROM reservas
     WHERE zona_id = $1
       AND estado IN ('pendiente', 'confirmada')
       AND rango && tstzrange($2::timestamptz, $3::timestamptz, '[)')
     ORDER BY lower(rango) ASC`,
    [zoneId, start, end]
  );

  return result.rows;
}

// Crear una solicitud de reserva
export async function createReservation({
  zoneId,
  start,
  end,
  estado = PENDING,
  notas,
  solicitadoPor,
}) {
  const result = await query(
    `INSERT INTO reservas (zona_id, rango, estado, notas, solicitado_por)
     VALUES ($1, tstzrange($2::timestamptz, $3::timestamptz, '[)'), $4, $5, $6)
     RETURNING id,
               zona_id,
               rango,
               lower(rango) AS inicio,
               upper(rango) AS fin,
               estado,
               notas,
               creado_en`,
    [zoneId, start, end, estado, notas, solicitadoPor]
  );

  return result.rows[0];
}

// Confirmar una solicitud de reserva de forma atómica
// Debe: (1) existir y estar pendiente, (2) no estar vencida, (3) no tener solapamiento
export async function confirmReservation(reservationId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Buscar y bloquear la reserva con FOR UPDATE
    const res = await client.query(
      `SELECT id,
              zona_id,
              rango,
              lower(rango) AS inicio,
              upper(rango) AS fin,
              estado,
              creado_en,
              confirmado_en,
              cancelado_en
       FROM reservas
       WHERE id = $1
       FOR UPDATE`,
      [reservationId]
    );

    const reservation = res.rows[0];
    if (!reservation) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }

    // 2. Si ya no está pendiente, no puede confirmarse
    if (reservation.estado !== PENDING) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_pending' };
    }

    // 3. Verificar vencimiento: si el rango ya terminó, marcar como expirada y rechazar
    const now = new Date();
    const rangeEnd = reservation.fin ? new Date(reservation.fin) : null;

    if (!rangeEnd || rangeEnd.getTime() <= now.getTime()) {
      await client.query(
        `UPDATE reservas SET estado = 'expirada' WHERE id = $1`,
        [reservationId]
      );
      await client.query('COMMIT');
      return { ok: false, reason: 'expired' };
    }

    // 4. Verificar solapamientos con otras reservas activas en la misma zona
    const overlap = await client.query(
      `SELECT id, zona_id, rango, estado
       FROM reservas
       WHERE zona_id = $1
         AND estado IN ('pendiente', 'confirmada')
         AND id <> $2
         AND rango && (SELECT rango FROM reservas WHERE id = $2)`,
      [reservation.zona_id, reservation.id]
    );

    if (overlap.rows.length > 0) {
      await client.query(
        `UPDATE reservas SET estado = 'rechazada' WHERE id = $1`,
        [reservationId]
      );
      await client.query('COMMIT');
      return { ok: false, reason: 'conflict' };
    }

    // 5. Confirmar
    const updated = await client.query(
      `UPDATE reservas
       SET estado = 'confirmada', confirmado_en = NOW()
       WHERE id = $1 AND estado = 'pendiente'
       RETURNING id,
                 zona_id,
                 rango,
                 lower(rango) AS inicio,
                 upper(rango) AS fin,
                 estado,
                 notas,
                 creado_en,
                 confirmado_en`,
      [reservationId]
    );

    await client.query('COMMIT');
    return { ok: true, reservation: updated.rows[0] };
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23P01') {
      return { ok: false, reason: 'conflict' };
    }
    throw e;
  } finally {
    client.release();
  }
}

// Rechazar una solicitud pendiente
export async function rejectReservation(reservationId) {
  const result = await query(
    `UPDATE reservas
     SET estado = 'rechazada'
     WHERE id = $1 AND estado = 'pendiente'
     RETURNING id,
               zona_id,
               rango,
               lower(rango) AS inicio,
               upper(rango) AS fin,
               estado,
               notas`,
    [reservationId]
  );

  return result.rows[0];
}

// Cancelar una reserva (confirmada o pendiente, libera el horario)
export async function cancelReservation(reservationId) {
  const result = await query(
    `UPDATE reservas
     SET estado = 'cancelada', cancelado_en = NOW()
     WHERE id = $1 AND estado IN ('confirmada', 'pendiente')
     RETURNING id,
               zona_id,
               rango,
               lower(rango) AS inicio,
               upper(rango) AS fin,
               estado,
               cancelado_en,
               notas`,
    [reservationId]
  );

  return result.rows[0];
}

// Reprogramar una reserva activa (pendiente o confirmada) de forma atómica
export async function rescheduleReservation(reservationId, { zoneId, start, end }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const res = await client.query(
      `SELECT id, zona_id, estado
       FROM reservas
       WHERE id = $1
       FOR UPDATE`,
      [reservationId]
    );

    const existing = res.rows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }

    if (![PENDING, CONFIRMED].includes(existing.estado)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_active' };
    }

    const targetZoneId = zoneId ? parseInt(zoneId, 10) : existing.zona_id;

    // Verificar solapamientos en la zona destino excluyendo la propia reserva
    const overlap = await client.query(
      `SELECT id
       FROM reservas
       WHERE zona_id = $1
         AND estado IN ('pendiente', 'confirmada')
         AND id <> $2
         AND rango && tstzrange($3::timestamptz, $4::timestamptz, '[)')`,
      [targetZoneId, reservationId, start, end]
    );

    if (overlap.rows.length > 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'conflict' };
    }

    const updated = await client.query(
      `UPDATE reservas
       SET zona_id = $2,
           rango = tstzrange($3::timestamptz, $4::timestamptz, '[)')
       WHERE id = $1
       RETURNING id,
                 zona_id,
                 rango,
                 lower(rango) AS inicio,
                 upper(rango) AS fin,
                 estado,
                 notas,
                 creado_en,
                 confirmado_en`,
      [reservationId, targetZoneId, start, end]
    );

    await client.query('COMMIT');
    return { ok: true, reservation: updated.rows[0] };
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23P01') {
      return { ok: false, reason: 'conflict' };
    }
    if (e.code === '23503') {
      return { ok: false, reason: 'zone_not_found' };
    }
    throw e;
  } finally {
    client.release();
  }
}

// Listar zonas (opcionalmente filtrar solo activas)
export async function listZones({ onlyActive = false } = {}) {
  const sql = onlyActive
    ? 'SELECT id, nombre, descripcion, capacidad, active, creado_en FROM zonas WHERE active = TRUE ORDER BY id'
    : 'SELECT id, nombre, descripcion, capacidad, active, creado_en FROM zonas ORDER BY id';
  const result = await query(sql);
  return result.rows;
}

// Obtener una zona por ID
export async function getZoneById(zoneId) {
  const result = await query(
    'SELECT id, nombre, descripcion, capacidad, active, creado_en FROM zonas WHERE id = $1',
    [zoneId]
  );
  return result.rows[0] || null;
}

// Crear zona (admin)
export async function createZone({ nombre, descripcion, capacidad, active = true }) {
  const result = await query(
    `INSERT INTO zonas (nombre, descripcion, capacidad, active)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nombre, descripcion, capacidad, active, creado_en`,
    [nombre, descripcion, capacidad, active]
  );
  return result.rows[0];
}

// Actualizar zona (admin: editar nombre, descripción, capacidad o activar/desactivar)
export async function updateZone(zoneId, { nombre, descripcion, capacidad, active }) {
  const existing = await getZoneById(zoneId);
  if (!existing) return null;

  const updatedNombre = nombre !== undefined ? nombre : existing.nombre;
  const updatedDesc = descripcion !== undefined ? descripcion : existing.descripcion;
  const updatedCap = capacidad !== undefined ? capacidad : existing.capacidad;
  const updatedActive = active !== undefined ? Boolean(active) : existing.active;

  const result = await query(
    `UPDATE zonas
     SET nombre = $2,
         descripcion = $3,
         capacidad = $4,
         active = $5
     WHERE id = $1
     RETURNING id, nombre, descripcion, capacidad, active, creado_en`,
    [zoneId, updatedNombre, updatedDesc, updatedCap, updatedActive]
  );
  return result.rows[0] || null;
}

// Obtener reservas con filtros opcionales (admin)
export async function listReservations({ zoneId, estado, date } = {}) {
  const conditions = [];
  const params = [];

  if (zoneId !== undefined && zoneId !== null && zoneId !== '') {
    params.push(parseInt(zoneId, 10));
    conditions.push(`r.zona_id = $${params.length}`);
  }

  if (estado && typeof estado === 'string') {
    params.push(estado);
    conditions.push(`r.estado = $${params.length}`);
  }

  if (date && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const tz = await getTimezone();
    params.push(date);
    params.push(tz);
    const dateIdx = params.length - 1;
    const tzIdx = params.length;
    conditions.push(
      `r.rango && tstzrange(($${dateIdx}::date || ' 00:00:00')::timestamp AT TIME ZONE $${tzIdx}, (($${dateIdx}::date + INTERVAL '1 day')::date || ' 00:00:00')::timestamp AT TIME ZONE $${tzIdx}, '[)')`
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT r.id,
            r.zona_id,
            z.nombre AS zona_nombre,
            z.capacidad AS zona_capacidad,
            r.rango,
            lower(r.rango) AS inicio,
            upper(r.rango) AS fin,
            r.estado,
            r.creado_en,
            r.confirmado_en,
            r.cancelado_en,
            r.notas,
            r.solicitado_por
     FROM reservas r
     LEFT JOIN zonas z ON z.id = r.zona_id
     ${whereClause}
     ORDER BY lower(r.rango) DESC, r.creado_en DESC
     LIMIT 200`,
    params
  );
  return result.rows;
}

// Obtener resumen estadístico de reservas y zonas (admin)
export async function getReservationsSummary() {
  await expirePendingReservations();
  const countsRes = await query(
    `SELECT estado, COUNT(*)::int AS total
     FROM reservas
     GROUP BY estado`
  );
  const zonesRes = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE active = TRUE)::int AS activas
     FROM zonas`
  );

  const byStatus = {
    pendiente: 0,
    confirmada: 0,
    cancelada: 0,
    rechazada: 0,
    expirada: 0,
  };
  for (const row of countsRes.rows) {
    byStatus[row.estado] = row.total;
  }

  const totalReservas = Object.values(byStatus).reduce((acc, n) => acc + n, 0);

  return {
    totalReservas,
    byStatus,
    zonas: {
      total: zonesRes.rows[0]?.total || 0,
      activas: zonesRes.rows[0]?.activas || 0,
    },
  };
}