import "server-only";
import { hash, verify } from "@node-rs/argon2";

export const hashSecret = (plain: string) => hash(plain);
export async function verifySecret(hashed: string | null | undefined, plain: string): Promise<boolean> {
  if (!hashed) return false;
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
