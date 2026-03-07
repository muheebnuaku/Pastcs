/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'next/link';
declare module 'next/navigation';
declare module 'next/server' {
  export interface NextRequest {
    cookies: {
      get(name: string): { value: string } | undefined;
      set(options: { name: string; value: string; [key: string]: unknown }): void;
    };
    headers: Headers;
    nextUrl: URL;
  }
  export class NextResponse {
    static next(options?: { request?: { headers: Headers } }): NextResponse;
    static redirect(url: string | URL): NextResponse;
    cookies: {
      set(options: { name: string; value: string; [key: string]: unknown }): void;
    };
  }
}
declare module 'next/image';
declare module 'next/headers' {
  export function cookies(): Promise<{
    get(name: string): { value: string } | undefined;
    set(options: { name: string; value: string; [key: string]: unknown }): void;
  }>;
}
declare module 'lucide-react';
declare module 'recharts';

// Fix Supabase types - use any for flexibility
declare module '@supabase/ssr' {
  export interface CookieOptions {
    name?: string;
    value?: string;
    maxAge?: number;
    path?: string;
    domain?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
  }
  
  interface SupabaseAuthClient {
    getSession(): Promise<{ data: { session: any }; error: any }>;
    getUser(): Promise<{ data: { user: any }; error: any }>;
    onAuthStateChange(callback: (event: any, session: any) => void): { data: { subscription: { unsubscribe(): void } } };
    signInWithPassword(credentials: { email: string; password: string }): Promise<{ error: any }>;
    signUp(credentials: { email: string; password: string; options?: any }): Promise<{ error: any }>;
    signOut(): Promise<void>;
    exchangeCodeForSession(code: string): Promise<{ error: any }>;
  }

  interface SupabaseClient {
    auth: SupabaseAuthClient;
    from(table: string): any;
    rpc(fn: string, params?: any): any;
  }
  
  export function createBrowserClient(
    supabaseUrl: string,
    supabaseKey: string
  ): SupabaseClient;
  
  export function createServerClient(
    supabaseUrl: string,
    supabaseKey: string,
    options: {
      cookies: {
        get(name: string): string | undefined;
        set(name: string, value: string, options: CookieOptions): void;
        remove(name: string, options: CookieOptions): void;
      };
    }
  ): SupabaseClient;
}
