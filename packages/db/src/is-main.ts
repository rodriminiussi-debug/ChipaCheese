import { pathToFileURL } from "node:url";

/** true si el módulo se ejecuta como script (tsx src/x.ts). Soporta rutas con espacios. */
export const isMain = (metaUrl: string) =>
  !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;
