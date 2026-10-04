import { PageHeader } from "@/components/app/page-header";
import { requirePermission } from "@/server/auth/session";
import { GLOSSARY } from "@/features/training/content";
import { Glossary } from "@/features/training/components/glossary";

export const metadata = { title: "Glosario" };

export default async function GlossaryPage() {
  await requirePermission("training:read");
  return (
    <>
      <PageHeader
        title="Glosario"
        description="Los términos que vas a ver en el sistema, con los valores de la planta."
      />
      <Glossary items={GLOSSARY} />
    </>
  );
}
