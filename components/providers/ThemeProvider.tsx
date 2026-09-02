'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/** Wraps next-themes so the rest of the app never imports it directly.
 * attribute="class" toggles a `dark` class on <html>, which globals.css
 * wires up for Tailwind's dark: variant (see @custom-variant there).
 * defaultTheme="system" + enableSystem means a viewer who's never touched
 * the toggle in /profile just gets their OS preference. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
