import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { Pool } = pg;

export function isPgliteMode() {
  return String(process.env.DB_ENGINE || 'postgres').toLowerCase() === 'pglite';
}

// Validar configuración obligatoria al arrancar
export function validateEnv() {
  const missing = [];

  if (!isPgliteMode()) {
    const hasUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
    const requiredDbVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    const hasIndividualDb = requiredDbVars.every(
      (k) => process.env[k] !== undefined && String(process.env[k]).trim() !== ''
    );

    if (!hasUrl && !hasIndividualDb) {
      missing.push('DATABASE_URL (o DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)');
    }

    if (hasUrl) {
      try {
        const parsed = new URL(process.env.DATABASE_URL);
        const hasUrlPass = Boolean(parsed.password && parsed.password.length > 0);
        const hasEnvPass = Boolean(process.env.DB_PASSWORD && String(process.env.DB_PASSWORD).length > 0);
        if (!hasUrlPass && !hasEnvPass) {
          missing.push('contraseña de PostgreSQL en DATABASE_URL o DB_PASSWORD');
        }
      } catch {
        missing.push('DATABASE_URL con formato válido');
      }
    }
  }

  if (!process.env.COOKIE_SECRET || process.env.COOKIE_SECRET.trim().length < 16) {
    missing.push('COOKIE_SECRET (mínimo 16 caracteres)');
  }

  if (missing.length > 0) {
    console.error(`[Config Error] Variables obligatorias faltantes o inválidas: ${missing.join(', ')}`);
    return false;
  }
  return true;
}

// Parse DATABASE_URL or use individual env vars ensuring password is always a string
export function buildPoolConfig() {
  const baseConfig = {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    try {
      const parsed = new URL(process.env.DATABASE_URL);
      const password = parsed.password
        ? decodeURIComponent(parsed.password)
        : String(process.env.DB_PASSWORD ?? '');
      const requiresSsl =
        process.env.DB_SSL === 'true' ||
        parsed.searchParams.get('sslmode') === 'require' ||
        parsed.hostname.includes('neon.tech') ||
        parsed.hostname.includes('supabase.co') ||
        parsed.hostname.includes('render.com');
      return {
        ...baseConfig,
        host: parsed.hostname || process.env.DB_HOST || 'localhost',
        port: parseInt(parsed.port || process.env.DB_PORT || '5432', 10),
        database: (parsed.pathname ? parsed.pathname.replace(/^\//, '') : '') || process.env.DB_NAME || 'reservas_gaming',
        user: parsed.username ? decodeURIComponent(parsed.username) : (process.env.DB_USER || 'postgres'),
        password: String(password),
        ...(requiresSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      };
    } catch {
      return {
        ...baseConfig,
        connectionString: process.env.DATABASE_URL,
        password: String(process.env.DB_PASSWORD ?? ''),
        ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
      };
    }
  }

  return {
    ...baseConfig,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'reservas_gaming',
    user: process.env.DB_USER || 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''),
  };
}

// Adaptador compatible con pg.Pool para PGlite (PostgreSQL 16 embebido local)
function createPglitePoolAdapter() {
  let dbPromise = null;
  let txQueue = Promise.resolve();

  async function initDb() {
    if (!dbPromise) {
      dbPromise = (async () => {
        const { PGlite } = await import('@electric-sql/pglite');
        const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
        const dataDirEnv = process.env.PGLITE_DATA_DIR;
        let dataDir;
        if (dataDirEnv === 'memory') {
          dataDir = undefined;
        } else {
          dataDir = path.resolve(__dirname, '../../', dataDirEnv || '.data/victory-db');
          fs.mkdirSync(dataDir, { recursive: true });
        }

        const db = dataDir
          ? new PGlite(dataDir, { extensions: { btree_gist } })
          : new PGlite({ extensions: { btree_gist } });

        await db.waitReady;

        // Aplicar migración inicial automáticamente si la base está vacía
        const check = await db.query(
          "SELECT to_regclass('public.zonas') AS exists"
        );
        if (!check.rows[0]?.exists) {
          const migrationPath = path.resolve(
            __dirname,
            '../../migrations/001_create_users_zones_reservations.sql'
          );
          const sql = fs.readFileSync(migrationPath, 'utf8');
          await db.exec(sql);
          const tz = process.env.DB_TIMEZONE || 'America/Argentina/Buenos_Aires';
          await db.query(
            'INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            ['timezone', tz]
          );
        }

        return db;
      })();
    }
    return dbPromise;
  }

  async function runQuery(db, text, params) {
    const res = await db.query(text, params);
    return {
      rows: res.rows || [],
      rowCount: res.affectedRows ?? (res.rows ? res.rows.length : 0),
    };
  }

  return {
    async query(text, params) {
      const db = await initDb();
      return runQuery(db, text, params);
    },
    async connect() {
      const db = await initDb();
      let releaseLock;
      const prev = txQueue;
      txQueue = new Promise((resolve) => {
        releaseLock = resolve;
      });
      await prev;
      let released = false;
      return {
        async query(text, params) {
          return runQuery(db, text, params);
        },
        release() {
          if (!released) {
            released = true;
            releaseLock();
          }
        },
      };
    },
    async end() {
      if (dbPromise) {
        const db = await dbPromise;
        await db.close();
        dbPromise = null;
      }
    },
    on() {},
  };
}

export const pool = isPgliteMode()
  ? createPglitePoolAdapter()
  : new Pool(buildPoolConfig());

if (!isPgliteMode()) {
  pool.on('error', (err) => {
    console.error('[DB Pool Error] Error inesperado en cliente inactivo:', err.code || err.message);
  });
}

// Helper para consultas parametrizadas
export async function query(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

// Helper para transacciones
export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Obtener zona horaria configurada
export async function getTimezone() {
  try {
    const result = await query(
      'SELECT value FROM config WHERE key = $1',
      ['timezone']
    );
    return result.rows[0]?.value || process.env.DB_TIMEZONE || 'America/Argentina/Buenos_Aires';
  } catch {
    return process.env.DB_TIMEZONE || 'America/Argentina/Buenos_Aires';
  }
}

// Verificar conexión con detalle seguro
export async function checkConnection() {
  try {
    await query('SELECT 1');
    return true;
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[DB Connection Error] No se pudo conectar a PostgreSQL (${err.code || 'UNKNOWN'}): Verifique que el servicio PostgreSQL esté activo en ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}.`);
    }
    return false;
  }
}