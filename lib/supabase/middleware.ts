import { createServerClient } from '@supabase/ssr';
import { NextResponse, NextRequest } from 'next/server';

// Runs on every request (proxy.ts) and renews the login when its
// hour-long access token has run out. The renewal rotates the refresh
// token, which can only be used once, so every cookie it writes must reach
// the browser. The old get/set/remove version rebuilt the response on each
// cookie and kept only the last one: the browser kept a spent refresh
// token, the next renewal was refused as reuse, Supabase ended the
// session, and students had to log in again. getAll/setAll writes them
// all onto one response.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // Don't put anything between creating the client and this call: it's
  // what refreshes an expired session.
  await supabase.auth.getUser();

  return response;
}
