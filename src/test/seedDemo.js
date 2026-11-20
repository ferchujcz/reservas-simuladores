// Carga inicial segura de simuladores de demostración para Victory Simulator
// Solo inserta si todavía no existen zonas cargadas (no borra ni modifica datos existentes).

import { pool } from '../config/db.js';
import { listZones, createZone } from '../services/reservationService.js';

async function seedDemo() {
  try {
    const existing = await listZones();
    if (existing.length > 0) {
      console.log(`Ya existen ${existing.length} simulador(es) cargado(s). No se modificó nada.`);
      return;
    }

    const demoZones = [
      {
        nombre: 'Cockpit F1 Pro Motion',
        descripcion: 'Direct Drive 20Nm · Plataforma de movimiento · Triple pantalla 165Hz',
        capacidad: 1,
        active: true,
      },
      {
        nombre: 'Simulador GT3 / TC Direct Drive',
        descripcion: 'Volante GT Pro · Pedales Load Cell · Pantalla curva ultrawide 49"',
        capacidad: 2,
        active: true,
      },
      {
        nombre: 'Sector Dúo / Amigos (2 Simuladores)',
        descripcion: '2 cockpits interconectados en red local para correr cabeza a cabeza',
        capacidad: 4,
        active: true,
      },
    ];

    for (const z of demoZones) {
      const created = await createZone(z);
      console.log(`Creado: #${created.id} — ${created.nombre} (máx. ${created.capacidad} pil.)`);
    }

    console.log('\nSimuladores de demostración listos para presentar Victory Simulator.');
  } finally {
    await pool.end();
  }
}

seedDemo().catch((err) => {
  console.error('Error al cargar simuladores de demo:', err.message);
  process.exit(1);
});
