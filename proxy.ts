import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  // status.pastcs.com is the status page (app/status). It has no sign-in,
  // so it skips the session refresh; anything else asked of that host
  // goes back to the main site.
  const host = request.headers.get('host') ?? '';
  if (host.startsWith('status.')) {
    const { pathname } = request.nextUrl;
    if (pathname === '/' || pathname === '/status') {
      return NextResponse.rewrite(new URL('/status', request.url));
    }
    // Files (sw.js, manifest.json, icons) and Next's own assets are served as-is.
    if (pathname.startsWith('/_next') || /\.[a-z0-9]+$/i.test(pathname)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL(pathname + request.nextUrl.search, `https://${host.replace(/^status\./, '')}`));
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
