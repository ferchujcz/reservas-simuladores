# Contexto del proyecto

## Descripción

Plataforma de reservas de salas / zonas de gaming para un establecimiento.

## Estado actual

Versión funcional completa (Backend + Seguridad + Página Pública de Reservas + Panel Administrativo SaaS).

## Alcance implementado

- Migración inicial de PostgreSQL 16+ para usuarios, zonas, configuración y reservas con `tstzrange` y `EXCLUDE USING GIST`.
- Backend en Node.js + Express + `pg` con validación de configuración de arranque, cierre ordenado (`SIGINT`/`SIGTERM`), expiración on-demand de reservas pendientes y transacciones con bloqueo de fila (`FOR UPDATE`).
- Seguridad reforzada: firma de sesiones con HMAC-SHA256, verificación de usuario en base de datos, protección CSRF + validación de `Origin`/`Referer`, rate-limiting en memoria contra fuerza bruta en `/api/auth/login`, cabeceras HTTP seguras (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`) y protección de todos los endpoints administrativos.
- Página pública responsive (`public/index.html`) con selección de zona, calendario diario, grilla de bloques horarios válidos/disponibles, formulario validado, aviso inmediato de conflicto (`409`) y comprobante de solicitud.
- Panel administrativo protegido (`public/admin/index.html`) con inicio/cierre de sesión, resumen estadístico (KPIs), filtros combinados por fecha/zona/estado, confirmación/rechazo/cancelación de reservas y CRUD/activación de zonas.
