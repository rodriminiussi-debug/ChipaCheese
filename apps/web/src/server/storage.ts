import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/env";

/**
 * Almacenamiento de archivos (fotos de facturas, conformidades de remito).
 * - local: disco (dev/test), servido por /api/files/[...key] con control de sesión.
 * - s3: Supabase Storage o cualquier S3 compatible (producción).
 */
export interface StoredFile {
  key: string;
  contentType: string;
}

const s3 =
  env.STORAGE_DRIVER === "s3"
    ? new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: true,
        credentials: { accessKeyId: env.S3_ACCESS_KEY ?? "", secretAccessKey: env.S3_SECRET_KEY ?? "" },
      })
    : null;

const localRoot = resolve(process.cwd(), env.STORAGE_LOCAL_DIR);

function localPath(key: string) {
  const p = resolve(localRoot, key);
  if (!p.startsWith(localRoot + sep)) throw new Error("clave de archivo inválida");
  return p;
}

export async function putFile(folder: string, file: File | Blob, filename = "archivo"): Promise<StoredFile> {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : "";
  const key = join(folder, `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${ext}`);
  const body = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  if (s3) {
    await s3.send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
  } else {
    const p = localPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  return { key, contentType };
}

export async function getFile(key: string): Promise<{ body: Buffer; contentType: string }> {
  if (s3) {
    const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType ?? "application/octet-stream" };
  }
  const body = await readFile(localPath(key));
  return { body, contentType: guessType(key) };
}

function guessType(key: string) {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return (
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      heic: "image/heic",
      pdf: "application/pdf",
    }[ext] ?? "application/octet-stream"
  );
}

export const fileUrl = (key: string) => `/api/files/${key}`;
