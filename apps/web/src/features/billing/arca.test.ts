import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { invoiceKey, normalizeHeader, parseArcaCsv, parseArcaDate, parseArcaType, splitCsv } from "./arca";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../../../e2e/fixtures", name), "utf-8");

describe("parser de Mis Comprobantes (RF-32)", () => {
  it("normaliza encabezados con tildes, puntos y mayúsculas", () => {
    expect(normalizeHeader("Cód. Autorización")).toBe("cod autorizacion");
    expect(normalizeHeader("  Imp. Neto Gravado ")).toBe("imp neto gravado");
    expect(normalizeHeader("Número Desde")).toBe("numero desde");
  });

  it("parsea el CSV de emitidos de ejemplo (separador ;, coma decimal)", () => {
    const p = parseArcaCsv(fixture("mis-comprobantes-emitidos.csv"), "issued");
    expect(p.delimiter).toBe(";");
    expect(p.errors).toEqual([]);
    expect(p.rows).toHaveLength(6);
    expect(p.rows[0]).toMatchObject({
      line: 2,
      date: "2026-09-15",
      type: "A",
      pointOfSale: "0002",
      number: "00001301",
      cae: "76123456789012",
      docNumber: "30712222227",
      name: "La Esperanza",
      net: 100000,
      vat: 21000,
      total: 121000,
    });
    expect(p.rows[3]).toMatchObject({ type: "NC_A", number: "00000077", total: 12100 });
    // La nota de débito no está soportada: queda marcada, no se pierde.
    expect(p.rows[5]).toMatchObject({ type: null, unsupported: expect.stringContaining("débito") });
  });

  it("parsea recibidos (Nro. Doc. Emisor, Total IVA)", () => {
    const p = parseArcaCsv(fixture("mis-comprobantes-recibidos.csv"), "received");
    expect(p.rows.map((r) => [r.docNumber, r.number, r.vat, r.total])).toEqual([
      ["30715555553", "00004521", 105000, 605000],
      ["30715555553", "00004602", 42000, 242000],
      ["30716666669", "00000880", 21000, 121000],
    ]);
  });

  it("acepta coma como separador, comillas, BOM, CRLF, fechas ISO y punto decimal", () => {
    const csv =
      "﻿Fecha,Tipo,Punto de Venta,Número Desde,Cód. Autorización,Nro. Doc. Receptor,Denominación Receptor,Imp. Neto Gravado,IVA,Imp. Total\r\n" +
      '2026-09-01,Factura B,10,5,"123",20-12345678-6,"Pérez, Juan",100.50,21.11,"121,61"\r\n';
    const p = parseArcaCsv(csv, "issued");
    expect(p.delimiter).toBe(",");
    expect(p.errors).toEqual([]);
    expect(p.rows[0]).toMatchObject({
      date: "2026-09-01",
      type: "B",
      pointOfSale: "0010",
      number: "00000005",
      cae: "123",
      docNumber: "20123456786",
      name: "Pérez, Juan",
      net: 100.5,
      vat: 21.11,
      total: 121.61,
    });
  });

  it("tolera columnas faltantes opcionales y reporta filas inválidas sin cortar la importación", () => {
    const csv = [
      "Fecha;Tipo;Punto de Venta;Número Desde;Imp. Total",
      "01/09/2026;1;2;10;1.500,00",
      "31/02/2026;1;2;11;100,00",
      "02/09/2026;1;2;12;abc",
      "03/09/2026;11;;13;50,00",
    ].join("\n");
    const p = parseArcaCsv(csv, "issued");
    expect(p.rows.map((r) => r.number)).toEqual(["00000010"]);
    expect(p.rows[0]).toMatchObject({ type: "A", total: 1500, net: 0, vat: 0, cae: null });
    expect(p.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(p.errors[0]!.message).toMatch(/Fecha inválida/);
  });

  it("rechaza archivos que no son de Mis Comprobantes", () => {
    expect(() => parseArcaCsv("nombre;edad\nJuan;3", "issued")).toThrow(/faltan las columnas/);
    expect(() => parseArcaCsv("", "issued")).toThrow(/vacío/);
  });

  it("interpreta tipos por código o por texto; notas de débito y otros quedan sin soporte", () => {
    expect(parseArcaType("1 - Factura A").type).toBe("A");
    expect(parseArcaType("6 - Factura B").type).toBe("B");
    expect(parseArcaType("11").type).toBe("C");
    expect(parseArcaType("201 - Factura de Crédito Electrónica MiPyMEs (FCE) A").type).toBe("A");
    expect(parseArcaType("3 - Nota de Crédito A").type).toBe("NC_A");
    expect(parseArcaType("Nota de Crédito C").type).toBe("NC_C");
    expect(parseArcaType("Factura B").type).toBe("B");
    expect(parseArcaType("7 - Nota de Débito B")).toEqual({
      type: null,
      unsupported: expect.stringContaining("débito"),
    });
    expect(parseArcaType("51 - Factura M").type).toBeNull();
  });

  it("guarda las notas de crédito en positivo y rechaza totales negativos en facturas", () => {
    const csv = [
      "Fecha;Tipo;Punto de Venta;Número Desde;Imp. Total",
      "01/09/2026;3;2;1;-500,00",
      "01/09/2026;1;2;2;-500,00",
    ].join("\n");
    const p = parseArcaCsv(csv, "issued");
    expect(p.rows.map((r) => r.total)).toEqual([500]);
    expect(p.errors).toHaveLength(1);
  });

  it("marca como no soportada la moneda extranjera", () => {
    const csv = [
      "Fecha;Tipo;Punto de Venta;Número Desde;Moneda;Imp. Total",
      "01/09/2026;1;2;1;DOL;100,00",
    ].join("\n");
    expect(parseArcaCsv(csv, "issued").rows[0]).toMatchObject({
      type: null,
      unsupported: expect.stringContaining("Moneda"),
    });
  });

  it("splitCsv respeta delimitadores y saltos de línea entre comillas", () => {
    expect(splitCsv('a;"b;c";"d""e"\n"x\ny";z', ";")).toEqual([
      ["a", "b;c", 'd"e'],
      ["x\ny", "z"],
    ]);
  });

  it("parseArcaDate valida fechas reales y invoiceKey ignora el relleno con ceros", () => {
    expect(parseArcaDate("15/09/2026")).toBe("2026-09-15");
    expect(parseArcaDate("2026-9-5")).toBe("2026-09-05");
    expect(parseArcaDate("31/04/2026")).toBeNull();
    expect(parseArcaDate("ayer")).toBeNull();
    expect(invoiceKey("A", "0002", "00001234")).toBe(invoiceKey("A", "2", "1234"));
    expect(invoiceKey("A", "0002", "1234")).not.toBe(invoiceKey("B", "0002", "1234"));
  });
});
