import { QualityTabs } from "@/features/quality/components/quality-tabs";

export default function QualityLayout({ children }: LayoutProps<"/calidad">) {
  return (
    <>
      <QualityTabs />
      {children}
    </>
  );
}
