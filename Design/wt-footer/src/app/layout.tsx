import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ciridae — AI Transformation",
  description: "We are Ciridae. The AI Transformation Firm",
  icons: {
    icon: "/sites/ciridae-0e008832/shared/seo/favicon-32x32.png",
    apple: "/sites/ciridae-0e008832/shared/seo/Favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
