import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD ?? ''),
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function createTestDatabase() {
  const client = await pool.connect();
  try {
    await client.query('CREATE DATABASE reservas_test');
    console.log('Base de datos de pruebas creada: reservas_test');
  } catch (e) {
    console.error('Error creando base de pruebas:', e);
  } finally {
    client.release();
  }
}

// Llamar a la función
createTestDatabase();