import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/**
 * Planilla BPM genérica en PDF con el formato de los registros en papel que ya conoce ASSAL
 * (RF-36): encabezado de empresa, título, código/versión del registro, período, tabla y firmas.
 */
export interface BpmColumn {
  header: string;
  /** Ancho relativo (flex). */
  width?: number;
  align?: "left" | "center" | "right";
}
export interface BpmSheet {
  title: string;
  code?: string;
  version?: string;
  period?: string;
  columns: BpmColumn[];
  rows: (string | number | null | undefined)[][];
  notes?: string;
  signatures?: string[];
  orientation?: "portrait" | "landscape";
}

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 8, fontFamily: "Helvetica" },
  header: { flexDirection: "row", borderWidth: 1, borderColor: "#000", marginBottom: 8 },
  brand: { width: "30%", padding: 6, borderRightWidth: 1, borderColor: "#000" },
  brandName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  title: {
    flex: 1,
    padding: 6,
    justifyContent: "center",
    alignItems: "center",
    borderRightWidth: 1,
    borderColor: "#000",
  },
  titleText: { fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "center" },
  meta: { width: "22%", padding: 6, gap: 2 },
  table: { borderWidth: 1, borderColor: "#000" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000", minHeight: 14 },
  th: {
    padding: 3,
    fontFamily: "Helvetica-Bold",
    backgroundColor: "#eee",
    borderRightWidth: 1,
    borderColor: "#000",
  },
  td: { padding: 3, borderRightWidth: 1, borderColor: "#000" },
  notes: { marginTop: 8 },
  signatures: { flexDirection: "row", justifyContent: "space-around", marginTop: 28 },
  signature: { width: 150, borderTopWidth: 1, borderColor: "#000", paddingTop: 2, textAlign: "center" },
  footer: {
    position: "absolute",
    bottom: 12,
    left: 24,
    right: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    color: "#555",
  },
});

function Sheet({ sheet, generatedAt }: { sheet: BpmSheet; generatedAt: string }) {
  const total = sheet.columns.reduce((a, c) => a + (c.width ?? 1), 0);
  const w = (c: BpmColumn) => `${((c.width ?? 1) / total) * 100}%`;
  return (
    <Document title={sheet.title} author="Pacon SRL — Chipa Cheese">
      <Page size="A4" orientation={sheet.orientation ?? "landscape"} style={s.page}>
        <View style={s.header} fixed>
          <View style={s.brand}>
            <Text style={s.brandName}>Chipa Cheese</Text>
            <Text>Pacon SRL</Text>
          </View>
          <View style={s.title}>
            <Text style={s.titleText}>{sheet.title}</Text>
          </View>
          <View style={s.meta}>
            {sheet.code ? <Text>Registro: {sheet.code}</Text> : null}
            {sheet.version ? <Text>Versión: {sheet.version}</Text> : null}
            {sheet.period ? <Text>Período: {sheet.period}</Text> : null}
          </View>
        </View>
        <View style={s.table}>
          <View style={s.row} fixed>
            {sheet.columns.map((c, i) => (
              <Text key={i} style={[s.th, { width: w(c), textAlign: c.align ?? "left" }]}>
                {c.header}
              </Text>
            ))}
          </View>
          {sheet.rows.map((r, ri) => (
            <View key={ri} style={s.row} wrap={false}>
              {sheet.columns.map((c, ci) => (
                <Text key={ci} style={[s.td, { width: w(c), textAlign: c.align ?? "left" }]}>
                  {r[ci] == null ? "" : String(r[ci])}
                </Text>
              ))}
            </View>
          ))}
        </View>
        {sheet.notes ? <Text style={s.notes}>{sheet.notes}</Text> : null}
        {sheet.signatures?.length ? (
          <View style={s.signatures} wrap={false}>
            {sheet.signatures.map((sig) => (
              <Text key={sig} style={s.signature}>
                {sig}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={s.footer} fixed>
          <Text>
            Generado por el sistema de gestión el {generatedAt}. Registros con usuario, fecha y hora.
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderBpmPdf(sheet: BpmSheet, generatedAt: string): Promise<Buffer> {
  return renderToBuffer(<Sheet sheet={sheet} generatedAt={generatedAt} />);
}

export function pdfResponse(buffer: Buffer, filename: string, inline = true) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
