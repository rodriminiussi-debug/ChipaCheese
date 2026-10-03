import { describe, expect, it } from "vitest";
import { parseRawLotQr, rawLotQrPayload } from "./lot-qr";

const ID = "3f2b8c1e-9d4a-4e6b-8a0c-1d2e3f4a5b6c";

describe("QR del lote de materia prima (RF-11)", () => {
  it("el contenido del QR es el id del lote y se lee de vuelta", () => {
    expect(rawLotQrPayload(ID)).toBe(ID);
    expect(parseRawLotQr(rawLotQrPayload(ID))).toBe(ID);
  });
  it("tolera lo que agrega el lector: espacios, salto de línea, mayúsculas o una URL", () => {
    expect(parseRawLotQr(`  ${ID}\r\n`)).toBe(ID);
    expect(parseRawLotQr(ID.toUpperCase())).toBe(ID);
    expect(parseRawLotQr(`https://chipa.example/stock/lotes/${ID}`)).toBe(ID);
  });
  it("rechaza texto sin un id válido", () => {
    expect(parseRawLotQr("")).toBeNull();
    expect(parseRawLotQr("260901-1")).toBeNull();
    expect(parseRawLotQr("3f2b8c1e-9d4a-4e6b-8a0c")).toBeNull();
  });
});
