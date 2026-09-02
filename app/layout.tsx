import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AuthProvider, ServiceWorkerRegister } from "@/components/providers";

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
  icons: {
    icon: [
      { url: '/past.png', type: 'image/png', sizes: '32x32' },
      { url: '/past.png', type: 'image/png', sizes: '192x192' },
      { url: '/past.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: { url: '/past.png', sizes: '180x180' },
    shortcut: '/past.png',
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
        <Script src="https://js.paystack.co/v1/inline.js" strategy="afterInteractive" />
        <ServiceWorkerRegister />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
