import { CatalogoNav } from "@/features/catalog/components/catalogo-nav";

export default function CatalogoLayout({ children }: LayoutProps<"/catalogo">) {
  return (
    <>
      <CatalogoNav />
      {children}
    </>
  );
}
