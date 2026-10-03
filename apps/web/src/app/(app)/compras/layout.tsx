import { ComprasNav } from "@/features/purchases/components/compras-nav";

export default function ComprasLayout({ children }: LayoutProps<"/compras">) {
  return (
    <>
      <ComprasNav />
      {children}
    </>
  );
}
