/**
 * QR del lote de materia prima (RF-11). La etiqueta lleva el id del lote (`raw_lots.id`, un uuid) y los
 * lectores USB/Bluetooth lo "tipean" como teclado: se acepta el texto tal cual o dentro de una URL.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Contenido del QR de un lote de materia prima. */
export function rawLotQrPayload(rawLotId: string): string {
  return rawLotId;
}

/** Id del lote leído de un QR (ignora espacios, saltos de línea y prefijos de URL); null si no hay un id válido. */
export function parseRawLotQr(text: string): string | null {
  const m = UUID.exec(text.trim());
  return m ? m[0].toLowerCase() : null;
}
