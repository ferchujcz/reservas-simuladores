// Ejecuta la migración inicial sobre la base configurada en DATABASE_URL (idempotente)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigration() {
  try {
    const check = await pool.query("SELECT to_regclass('public.zonas') AS exists");
    if (check.rows[0]?.exists) {
      console.log('Las tablas ya existen en la base de datos. No se requiere migración.');
      return;
    }

    const migrationPath = path.resolve(
      __dirname,
      '../../migrations/001_create_users_zones_reservations.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);

    const tz = process.env.DB_TIMEZONE || 'America/Argentina/Buenos_Aires';
    await pool.query(
      'INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      ['timezone', tz]
    );

    console.log('Migración aplicada correctamente y zona horaria configurada:', tz);
  } finally {
    await pool.end();
  }
}

runMigration().catch((err) => {
  console.error('Error al aplicar migración:', err.message);
  process.exit(1);
});
