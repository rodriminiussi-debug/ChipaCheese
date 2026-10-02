import Link from "next/link";
import { MessageCircle, PhoneCall } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateText } from "@/components/app/format";
import { formatNumber } from "@chipa/domain";
import type { OverdueCustomer } from "../service";

/** WhatsApp: deja solo dígitos (formato internacional sin "+"). */
const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, "")}`;

/** RF-04: clientes sin pedir hace más de su frecuencia habitual × factor. Reemplaza las llamadas a todos. */
export function OverdueCustomers({ customers, factor }: { customers: OverdueCustomer[]; factor: number }) {
  return (
    <Card data-testid="overdue-customers">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PhoneCall className="size-4" /> Clientes para llamar
          {customers.length ? (
            <span className="bg-destructive/10 text-destructive rounded-full px-2 text-xs">
              {customers.length}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          Hace más de {formatNumber(factor, 1)} veces su frecuencia habitual que no piden.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {customers.length === 0 ? (
          <p className="text-muted-foreground text-sm">Todos los clientes están al día.</p>
        ) : (
          <ul className="divide-y">
            {customers.map((c) => (
              <li key={c.customerId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Link href={`/clientes/${c.customerId}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    Sin pedir hace {c.daysSinceLastOrder} días · pide cada{" "}
                    {formatNumber(c.averageIntervalDays, 0)} días · último{" "}
                    <DateText value={c.lastOrderDate} />
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {c.whatsapp ? (
                    <Button asChild variant="outline" size="icon" aria-label={`WhatsApp a ${c.name}`}>
                      <a href={waLink(c.whatsapp)} target="_blank" rel="noreferrer">
                        <MessageCircle />
                      </a>
                    </Button>
                  ) : null}
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/pedidos/nuevo?cliente=${c.customerId}`}>Cargar pedido</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
