# Deuda funcional (criterios de aceptación pendientes)

Criterios de las historias de Linear que no quedaron cubiertos en el sprint del módulo. Se resuelven en el
**Sprint de hardening** (tras integrar M5–M8). Actualizar este archivo al cerrar cada ítem.

| Historia | Criterio pendiente | Notas |
|---|---|---|
| RF-20 (ROD-245) | Registro de planta sin señal (cola offline) | Usar `useOfflineAction` en consumos, pesadas y envasado; requiere idempotencia por `client_id` |
| RF-15 (ROD-251) | Inventario retomable sin señal | Guardado parcial ya existe; falta cola offline |
| RF-02 (ROD-261) | Pedido cargado sin señal queda en cola | `useOfflineAction` en `/pedidos/nuevo` + `client_id` en orders |
| RF-11 (ROD-258) | QR del lote de materia prima para elegirlo en producción | Etiqueta de lote MP + lector QR en el formulario de consumos (RF-20) |
| RF-17 (ROD-253) | Mostrar órdenes de compra en camino como disponibilidad futura | Leer `purchase_order_items` pendientes en el simulador |
| RF-10 (ROD-257) | PDF/impresión de la orden de compra; OC con "retiro" como parada de la hoja de ruta | La parada depende de M5 |
| RF-03 (ROD-262) | Motivo obligatorio al cancelar; despacho actualiza el estado automáticamente | Lo segundo lo cubre M5 al integrar |
| RF-05 (ROD-264) | Aviso si el pedido ocupa más de X % de la capacidad semanal; aceptar la fecha posible como comprometida | Parámetro `orders.max_weekly_capacity_pct` |
| RF-23 (ROD-248) | Sugerir reemplazos habilitados ante una ausencia | La matriz y la alerta crítica ya existen |
| RF-09 (ROD-256) | Exportar historial de precios a Excel | Helper `buildXlsx` disponible |
| M4 | Subir `features/production/calc.ts` y `features/people/skills.ts` a `packages/domain` | Reglas puras que quedaron en la app |
