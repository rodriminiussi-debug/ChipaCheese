import Link from "next/link";
import { formatInvoiceNumber } from "@chipa/domain";
import { DateText, Money, Num } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UNIT } from "@/lib/labels";
import type { InvoiceDetail } from "../invoices";

/** Factura confirmada (solo lectura): cabecera, líneas con su insumo y totales. */
export function InvoiceSummary({
  invoice,
  ingredientNames,
}: {
  invoice: InvoiceDetail;
  ingredientNames: Map<string, string>;
}) {
  return (
    <div className="grid gap-6">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            [
              "Proveedor",
              invoice.supplier ? (
                <Link key="s" href={`/proveedores/${invoice.supplier.id}`} className="hover:underline">
                  {invoice.supplier.legalName}
                </Link>
              ) : (
                "—"
              ),
            ],
            [
              "Comprobante",
              `${invoice.invoiceType.replace("_", " ")} ${formatInvoiceNumber(invoice.pointOfSale, invoice.number)}`,
            ],
            ["Emisión", <DateText key="i" value={invoice.issueDate} />],
            ["Vencimiento", <DateText key="d" value={invoice.dueDate} />],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descripción</TableHead>
              <TableHead>Insumo</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Neto unit.</TableHead>
              <TableHead className="text-right">IVA</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.description}</TableCell>
                <TableCell>
                  {i.ingredientId ? (
                    <Link href={`/compras/precios/${i.ingredientId}`} className="hover:underline">
                      {ingredientNames.get(i.ingredientId) ?? "Insumo"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Num
                    value={i.qty}
                    decimals={Number.isInteger(i.qty) ? 0 : 3}
                    suffix={i.unit ? UNIT[i.unit] : undefined}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={i.unitPriceNet} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={i.vatAmount} />{" "}
                  <span className="text-muted-foreground text-xs">
                    ({String(i.vatRate).replace(".", ",")} %)
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Money value={i.lineTotal} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <dl className="ml-auto grid w-full max-w-sm grid-cols-2 gap-x-4 gap-y-1">
        <dt>Neto</dt>
        <dd className="text-right">
          <Money value={invoice.netTotal} decimals={2} />
        </dd>
        <dt>IVA</dt>
        <dd className="text-right">
          <Money value={invoice.vatTotal} decimals={2} />
        </dd>
        <dt>Percepciones y otros</dt>
        <dd className="text-right">
          <Money value={invoice.otherTaxes} decimals={2} />
        </dd>
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold">
          <Money value={invoice.total} decimals={2} />
        </dd>
      </dl>
      {invoice.notes ? <p className="text-muted-foreground text-sm">{invoice.notes}</p> : null}
    </div>
  );
}
