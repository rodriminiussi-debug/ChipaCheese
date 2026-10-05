import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { ProductForm } from "@/features/catalog/components/product-form";
import { productFormOptions } from "@/features/catalog/service";

export const metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  await requirePermission("catalog:write");
  const options = await productFormOptions(db);
  return (
    <>
      <PageHeader
        title="Nuevo producto"
        description="Elegí el tipo y completá lo que le corresponde: el costo y el margen se calculan solos."
      />
      <ProductForm options={options} />
    </>
  );
}
