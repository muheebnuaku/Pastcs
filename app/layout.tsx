import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PastCS - Exam Practice Platform",
  description: "Exam practice platform for IT students at every level. Build your question bank, simulate exams, and track your progress.",
  keywords: ["exam practice", "University of Ghana", "IT students", "DCIT", "past questions"],
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
      <body className={`${inter.variable} font-sans antialiased bg-gray-50`}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
