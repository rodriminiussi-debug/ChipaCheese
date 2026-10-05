import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Money, Num } from "@/components/app/format";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { PRODUCT_KIND } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { toInput } from "@/features/purchases/input";
import { ProductForm, type ProductFormInitial } from "@/features/catalog/components/product-form";
import { getProduct, productFormOptions, productPricing } from "@/features/catalog/service";
import { PRICE_STATUS } from "@/features/pricing/labels";

export const metadata = { title: "Producto" };

export default async function ProductPage(props: PageProps<"/catalogo/productos/[id]">) {
  await requirePermission("catalog:write");
  const { id } = await props.params;
  const [product, options, pricing] = await Promise.all([
    getProduct(db, id),
    productFormOptions(db),
    productPricing(db, id),
  ]);
  if (!product) notFound();
  // El base que ya tenía puede estar inactivo: se sigue mostrando para no perderlo al guardar.
  if (product.baseProduct && !options.baseProducts.some((b) => b.id === product.baseProduct!.id))
    options.baseProducts.push({
      id: product.baseProduct.id,
      code: product.baseProduct.code,
      name: `${product.baseProduct.name} (inactivo)`,
      netWeightKg: product.baseProduct.netWeightKg,
    });
  const derivedKg =
    product.baseProduct && product.baseQty
      ? Math.round(product.baseQty * product.baseProduct.netWeightKg * 1000) / 1000
      : null;

  const initial: ProductFormInitial = {
    id: product.id,
    kind: product.kind,
    code: product.code,
    name: product.name,
    shape: product.shape,
    presentation: product.presentation,
    // Elaborado: si el equivalente es el calculado (base × cantidad), queda vacío para que se recalcule.
    netWeightKg:
      product.kind === "resale" || (product.kind === "prepared" && product.netWeightKg === derivedKg)
        ? ""
        : toInput(product.netWeightKg),
    unitLabel: product.unitLabel,
    barcode: product.barcode ?? "",
    defaultSupplierId: product.defaultSupplierId,
    description: product.description ?? "",
    boardCode: product.boardCode ?? "",
    minStockUnits: product.minStockUnits,
    baseProductId: product.baseProductId,
    baseQty: toInput(product.baseQty),
    components: product.components.map((c) => ({
      ingredientId: c.ingredientId,
      qtyPerUnit: toInput(c.qtyPerUnit),
    })),
    availableInStore: product.availableInStore,
    availableForOrders: product.availableForOrders,
    active: product.active,
    initialCost: "",
    initialPrices: [],
  };

  return (
    <>
      <PageHeader
        title={product.name}
        description={
          <>
            {product.code} · <StatusBadge>{PRODUCT_KIND[product.kind]?.label}</StatusBadge>{" "}
            {product.active ? null : <StatusBadge tone="warn">Inactivo</StatusBadge>}
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/precios">Ver en Precios</Link>
          </Button>
        }
      />
      <section
        aria-label="Costo y precios actuales"
        className="mb-8 grid max-w-3xl gap-2 rounded-lg border p-4 text-sm"
      >
        <h2 className="font-semibold">Costo y precios actuales</h2>
        {pricing ? (
          <>
            <div>
              Costo directo por unidad:{" "}
              {pricing.cost != null ? (
                <Money value={pricing.cost} className="font-medium" />
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  precio faltante ({pricing.missingPrices.join(", ") || "sin datos"})
                </span>
              )}
            </div>
            {pricing.lists.length ? (
              <ul className="grid gap-1">
                {pricing.lists.map((l) => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-2">
                    <span>{l.name}</span>
                    <span className="tabular-nums">
                      {l.price != null ? (
                        <Money value={l.price} />
                      ) : (
                        <span className="text-muted-foreground">sin precio</span>
                      )}
                      {l.marginPct != null ? (
                        <>
                          {" · margen "}
                          <Num value={l.marginPct} decimals={1} suffix="%" />
                        </>
                      ) : null}{" "}
                      <StatusBadge tone={PRICE_STATUS[l.status].tone}>
                        {PRICE_STATUS[l.status].label}
                      </StatusBadge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground">No se puede calcular el costo: no hay una receta activa.</p>
        )}
      </section>
      <ProductForm options={options} initial={initial} canDelete />
    </>
  );
}
