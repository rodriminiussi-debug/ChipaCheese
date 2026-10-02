import { resolve } from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// Monorepo: un único .env en la raíz (las variables ya definidas en el entorno tienen prioridad).
config({ path: resolve(import.meta.dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@chipa/db", "@chipa/domain"],
  serverExternalPackages: ["@node-rs/argon2", "postgres", "exceljs", "@react-pdf/renderer"],
  typedRoutes: true,
  experimental: {
    serverActions: { bodySizeLimit: "12mb" }, // fotos de facturas
  },
};

export default nextConfig;
