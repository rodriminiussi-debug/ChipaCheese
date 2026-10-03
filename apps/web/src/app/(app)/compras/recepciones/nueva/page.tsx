import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { receptionFormData } from "@/features/purchases/service";
import { ReceptionForm } from "@/features/purchases/components/reception-form";

export const metadata = { title: "Recibir mercadería" };

export default async function NewReceptionPage(props: PageProps<"/compras/recepciones/nueva">) {
  await requirePermission("purchases:write");
  const { orden } = await props.searchParams;
  const data = await receptionFormData(db, typeof orden === "string" ? orden : null);
  return (
    <>
      <PageHeader
        title={data.order ? `Recibir ${data.order.number}` : "Recibir mercadería"}
        description="Cantidad real, lote y vencimiento del proveedor; los refrigerados llevan temperatura (máx. 5 °C)."
      />
      <ReceptionForm data={data} />
    </>
  );
}
