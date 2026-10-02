import { getCurrentUser } from "@/server/auth/session";
import { getFile } from "@/server/storage";

export async function GET(_req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  if (!(await getCurrentUser())) return new Response("No autorizado", { status: 401 });
  const { key } = await ctx.params;
  try {
    const { body, contentType } = await getFile(key.join("/"));
    return new Response(new Uint8Array(body), {
      headers: { "content-type": contentType, "cache-control": "private, max-age=3600" },
    });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
