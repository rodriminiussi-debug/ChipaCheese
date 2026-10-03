import { notFound } from "next/navigation";
import { formatCuit } from "@chipa/domain";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getSupplier, supplierIngredientRows } from "@/features/suppliers/service";
import { SupplierForm } from "@/features/suppliers/components/supplier-form";
import { SupplierIngredients } from "@/features/suppliers/components/supplier-ingredients";
import { getSupplierAccount } from "@/features/purchases/service";
import { SupplierAccountView } from "@/features/purchases/components/supplier-account-view";
import { can } from "@/lib/rbac";
import { todayAR } from "@/lib/dates";

export default async function SupplierPage(props: PageProps<"/proveedores/[id]">) {
  const user = await requirePermission("suppliers:read");
  const { id } = await props.params;
  const supplier = await getSupplier(db, id);
  if (!supplier) notFound();
  const editable = can(user.role, "suppliers:write");
  const showAccount = can(user.role, "purchases:read");
  const today = todayAR();
  const [rows, account] = await Promise.all([
    supplierIngredientRows(db, id),
    showAccount ? getSupplierAccount(db, id, today) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title={supplier.legalName}
        description={
          <>
            {supplier.cuit ? `CUIT ${formatCuit(supplier.cuit)} · ` : ""}entrega en {supplier.leadTimeDays}{" "}
            {supplier.leadTimeDays === 1 ? "día" : "días"} ·{" "}
            {supplier.paymentTermsDays ? `pago a ${supplier.paymentTermsDays} días` : "pago contado"}{" "}
            {!supplier.active ? <StatusBadge tone="bad">Inactivo</StatusBadge> : null}
          </>
        }
      />
      <Tabs defaultValue="ficha">
        <TabsList>
          <TabsTrigger value="ficha">Ficha</TabsTrigger>
          <TabsTrigger value="insumos">Insumos y precios</TabsTrigger>
          {showAccount ? <TabsTrigger value="cuenta">Cuenta corriente</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="ficha" className="pt-4">
          {editable ? (
            <SupplierForm
              initial={{
                id: supplier.id,
                legalName: supplier.legalName,
                tradeName: supplier.tradeName ?? "",
                cuit: supplier.cuit ?? "",
                leadTimeDays: supplier.leadTimeDays,
                paymentTermsDays: supplier.paymentTermsDays,
                paymentNotes: supplier.paymentNotes ?? "",
                whatsapp: supplier.whatsapp ?? "",
                notes: supplier.notes ?? "",
                active: supplier.active,
              }}
            />
          ) : (
            <dl className="grid max-w-3xl gap-4 sm:grid-cols-2">
              {(
                [
                  ["Razón social", supplier.legalName],
                  ["Nombre de fantasía", supplier.tradeName],
                  ["CUIT", supplier.cuit ? formatCuit(supplier.cuit) : null],
                  ["WhatsApp", supplier.whatsapp],
                  ["Plazo de entrega", `${supplier.leadTimeDays} días`],
                  ["Plazo de pago", supplier.paymentTermsDays ? `${supplier.paymentTermsDays} días` : "Contado"],
                  ["Condición de pago", supplier.paymentNotes],
                  ["Notas", supplier.notes],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd>{value || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </TabsContent>
        <TabsContent value="insumos" className="pt-4">
          <SupplierIngredients supplierId={supplier.id} rows={rows} editable={editable} />
        </TabsContent>
        {account ? (
          <TabsContent value="cuenta" className="pt-4">
            <SupplierAccountView
              supplierId={supplier.id}
              account={account}
              today={today}
              canPay={can(user.role, "purchases:write")}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
