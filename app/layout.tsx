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
    icon: '/pastcs.png',
    apple: '/pastcs.png',
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
