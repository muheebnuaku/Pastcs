import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider, ServiceWorkerRegister, ThemeProvider } from "@/components/providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Used for the marketing site (landing page, nav, footer) — everywhere else
// in the app keeps the sans body font.
const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#e8603c",
};

export const metadata: Metadata = {
  title: "PastCS - Exam Practice Platform",
  description: "Exam practice platform for IT students at every level. Build your question bank, simulate exams, and track your progress.",
  keywords: ["exam practice", "University of Ghana", "IT students", "DCIT", "past questions"],
  manifest: "/manifest.json",
  // Square icons (public/icons): the old ones were 864×724 but declared as
  // 192 and 512, which stops Android offering "Install app" and gives
  // iPhones a letterboxed home-screen icon.
  icons: {
    icon: [
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: { url: '/apple-touch-icon.png', sizes: '180x180' },
    shortcut: '/icons/icon-192.png',
  },
  // Opened from the iPhone home screen: full screen, named PastCS.
  appleWebApp: {
    capable: true,
    title: 'PastCS',
    statusBarStyle: 'default',
  },
  openGraph: {
    title: "PastCS - Exam Practice Platform",
    description: "Exam practice platform for IT students at every level. Build your question bank, simulate exams, and track your progress.",
    url: "https://www.pastcs.com",
    siteName: "PastCS",
    images: [
      {
        url: "/past.png",
        width: 1536,
        height: 1024,
        alt: "PastCS",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PastCS - Exam Practice Platform",
    description: "Exam practice platform for IT students at every level.",
    images: ["/past.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${plusJakarta.variable} font-sans antialiased bg-gray-50`}>
        {/* Paystack's inline.js is NOT loaded globally: on every page it threw
            "put your Paystack Inline javascript file inside of a form element"
            and pulled in Paystack's checkout frame for every visitor. The two
            payment modals (PaywallModal, TutorPricingModal) load it on demand. */}
        <ServiceWorkerRegister />
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
