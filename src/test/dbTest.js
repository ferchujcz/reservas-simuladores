import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Si no se usa DATABASE_URL, usar valores por defecto
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'reservas_test',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function testConnection() {
  try {
    const result = await pool.query('SELECT 1');
    console.log('Conexión exitosa a la base de datos de pruebas:', result.rows);
  } catch (e) {
    console.error('Error al conectar:', e);
  }
}

testConnection();