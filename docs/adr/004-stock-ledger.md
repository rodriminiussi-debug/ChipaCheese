# ADR 004 — Stock como libro mayor

**Estado:** aceptada · 02/10/2026

## Decisión

`stock_movements` registra cada entrada/salida con signo, ítem (insumo o producto), lote (de materia prima o terminado),
ubicación y documento origen (`ref_table`, `ref_id`). El stock es siempre `SUM(qty)`.
Tipos: recepción, consumo de producción, envasado, despacho, venta del local, transferencia, ajuste de inventario, devolución, merma.

## Por qué

- RF-13: stock = recepciones − consumos ± ajustes. RF-35: trazabilidad lote ↔ proveedores ↔ clientes en segundos.
- No existen saldos editables que se desincronicen.

## Consecuencias

- Corregir stock = movimiento de ajuste (auditable), nunca un UPDATE de saldo.
