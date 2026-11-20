-- Migración inicial: usuarios, zonas y reservas
-- PostgreSQL 16+ con range types y exclusion constraints
-- 
-- NOTA: La zona horaria del establecimiento se configura en el backend
-- (variable de entorno DB_TIMEZONE o tabla de configuración).
-- Todos los timestamps se almacenan como TIMESTAMPTZ.

-- Habilitar extensión para exclusion constraints con rangos
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- Configuración del establecimiento (zona horaria)
-- ============================================================
CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Comentario: La zona horaria se establece mediante:
-- INSERT INTO config (key, value) VALUES ('timezone', 'America/Argentina/Buenos_Aires');
-- El backend debe usar esta zona para crear rangos de reserva.

-- ============================================================
-- Tabla: zonas
-- Zonas de gaming disponibles para reserva
-- ============================================================
CREATE TABLE zonas (
    id          SERIAL PRIMARY KEY,
    nombre      TEXT NOT NULL,
    descripcion TEXT,
    capacidad   INTEGER CHECK (capacidad > 0),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Tabla: usuarios
-- Gestión de usuarios del sistema (admin y clientes)
-- password_hash usa bcrypt (3 rounds por defecto) o argon2id
-- ============================================================
CREATE TABLE usuarios (
    id           SERIAL PRIMARY KEY,
    email        TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,  -- bcrypt: $2b$XX$... o argon2id
    nombre       TEXT NOT NULL,
    rol          TEXT NOT NULL DEFAULT 'cliente' CHECK (rol IN ('cliente', 'admin')),
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Tabla: reservas
-- Sistema de reservas con prevención de solapamientos
-- ============================================================
CREATE TYPE estado_reserva AS ENUM ('pendiente', 'confirmada', 'rechazada', 'cancelada', 'expirada');

CREATE TABLE reservas (
    id           SERIAL PRIMARY KEY,
    zona_id      INTEGER NOT NULL REFERENCES zonas(id),
    rango        tstzrange NOT NULL,
    estado       estado_reserva NOT NULL DEFAULT 'pendiente',
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmado_en TIMESTAMPTZ,
    cancelado_en TIMESTAMPTZ,
    notas        TEXT,
    solicitado_por INTEGER REFERENCES usuarios(id)  -- NULL si es invitado
);

-- ============================================================
-- Restricciones de integridad y prevención de solapamientos
-- ============================================================

-- Exclusion constraint: evita solapamientos entre reservas de la misma zona
-- Solo se aplica a estados que 'bloquean' el horario: pendiente y confirmada
-- Estados 'expirada', 'rechazada' y 'cancelada' no bloquean
-- 
-- NOTA sobre expiración: Las reservas 'pendiente' pueden expirar.
-- El backend debe:
-- 1. Ejecutar una task/Cron que actualice el estado a 'expirada'
--    cuando rango.upper < NOW()
-- 2. El constraint WHERE incluye 'pendiente', por lo que al cambiar
--    a 'expirada', la reserva deja de bloquear el rango
--
-- NOTA sobre concurrencia: Para crear y confirmar reservas de forma segura:
-- 1. Usar transacciones SERIALIZABLE o FOR UPDATE en la consulta
-- 2. El constraint de exclusión garantiza que dos reservas no pueden
--    solaparse si ambas intentan insertar en el mismo rango/zona
ALTER TABLE reservas 
ADD CONSTRAINT reserva_por_zona_no_solapada 
EXCLUDE USING GIST (zona_id WITH =, rango WITH &&)
WHERE (estado IN ('pendiente', 'confirmada'));

-- ============================================================
-- Índices para rendimiento
-- ============================================================

-- Índice para búsquedas de disponibilidad por zona
CREATE INDEX idx_reservas_zona_id ON reservas(zona_id);

-- Índice parcial para reservas pendientes (usado en verificación de solapamientos)
CREATE INDEX idx_reservas_pendientes_por_zona 
ON reservas(zona_id, rango)
WHERE estado = 'pendiente';

-- Índice para consultas de calendario
CREATE INDEX idx_reservas_rango_gist ON reservas USING GIST (rango);

-- ============================================================
-- Triggers y funciones auxiliares (conceptual)
-- ============================================================

-- Función para verificar disponibilidad de un rango en una zona
-- Se llama desde el backend antes de INSERT
-- 
-- Ejemplo de uso en backend:
--   SELECT COUNT(*) = 0 AS disponible
--   FROM reservas
--   WHERE zona_id = $1
--     AND estado IN ('pendiente', 'confirmada')
--     AND rango && tstzrange($2, $3, '[)');

-- Función para expirar reservas pendientes vencidas
-- El backend ejecuta esto periódicamente:
--   UPDATE reservas
--   SET estado = 'expirada'
--   WHERE estado = 'pendiente' AND rango <@ tstzrange(NULL, NOW(), '[)');
--   -- NULL a upper = [hasta ahora), i.e., rango que termina antes de ahora

-- ============================================================
-- Políticas de seguridad
-- ============================================================

-- Comentario: El backend debe validar:
-- 1. El usuario existe y tiene rol 'admin' para operaciones CRUD
-- 2. El rango de tiempo es válido (start < end)
-- 3. El rango no cruza zonas horarias distintas
-- 4. Las contraseñas nunca se almacenan ni transmiten sin hash

-- ============================================================
-- Datos iniciales (SIN credenciales)
-- ============================================================

-- Comentario: Ningún usuario, zona ni reserva debe insertarse aquí.
-- Para primer acceso:
--   - El admin crea su cuenta vía endpoint /api/auth/register
--   - Se configura la zona horaria en tabla config
--   - Se crean zonas vía endpoint /api/admin/zonas