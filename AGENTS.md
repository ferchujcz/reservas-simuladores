# AGENTS.md

## Proyecto: Reservas Gaming

## Preferencias generales de trabajo

- Responderme en español.
- Antes de modificar código, inspeccioná la estructura del proyecto.
- No reescribas archivos completos si basta con un cambio pequeño.
- No repitas análisis que ya estén documentados.
- Antes de modificar la base de datos, explicá los riesgos.
- Nunca borres datos, archivos ni configuraciones sin mi autorización.
- No muestres claves API, contraseñas ni credenciales.
- Priorizá cambios pequeños, verificables y fáciles de revertir.
- Si falta contexto, leé primero AGENTS.md y docs/CONTEXTO.md.
- Al finalizar una tarea, resumí los archivos modificados y las pruebas realizadas.
- Actualizá docs/PROGRESO.md con los avances y los próximos pasos.
- Mantené docs/CONTEXTO.md breve y actualizado.
- No incluyas archivos de dependencias, binarios o archivos generados en el contexto salvo que sean necesarios.
- No copies conversaciones enteras en la documentación.
- Usa los modelos gratuitos disponibles cuando sea posible.

## Reglas globales de trabajo

- Antes de programar: identificá la raíz del proyecto y revisá AGENTS.md.
- Leé docs/CONTEXTO.md y docs/PROGRESO.md si existen.
- Examiná primero la estructura y las tecnologías utilizadas.
- Inspeccioná únicamente los archivos relevantes para la tarea.
- Resume brevemente el estado actual y el plan antes de cambios importantes.
- No repitas análisis que ya estén documentados.
- No inventes información si no has podido verificarla.

## Reglas de seguridad

- No muestres claves API, contraseñas ni secretos.
- No borres archivos ni datos sin autorización.
- No ejecutes migraciones destructivas sin explicar sus riesgos.
- Revisá los cambios antes de finalizar.

## Al terminar cada tarea

- Resumí los archivos modificados.
- Indicá las pruebas realizadas y sus resultados.
- Actualizá docs/PROGRESO.md con lo pendiente.
- Actualizá docs/CONTEXTO.md solo si cambió información importante.
- Dejá instrucciones concretas para retomar el trabajo en otra sesión.
- No continuyas con la siguiente fase sin aprobación del usuario.

## Stack actual

- PostgreSQL 16+ con migración SQL aplicada manualmente (sin ORM en esta etapa).
- Backend mínimo en Node.js con el driver nativo `pg`.
- Sin Docker, sin servicios externos ni integraciones futuras en esta etapa.

## Convenciones

- Consultas SQL siempre parametrizadas (sin concatenación de strings).
- Contraseñas con hash seguro (bcrypt o argon2).
- Validación de datos en servidor.
- Cookies de autenticación con flags seguras (httpOnly, secure, sameSite).
