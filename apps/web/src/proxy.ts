import { NextResponse, type NextRequest } from "next/server";

/**
 * Chequeo optimista: sin cookie de sesión → /login. La validación real de la sesión y los
 * permisos se hace en el servidor (requireUser / action()), nunca solo acá.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("chipa_session");
  const { pathname } = request.nextUrl;
  if (!hasSession && !pathname.startsWith("/login")) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/health|offline|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|brand/).*)",
  ],
};
