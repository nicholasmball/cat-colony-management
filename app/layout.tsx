import type { Metadata, Viewport } from "next";
import { Raleway, Cormorant_Garamond } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

// Matched to the SCoT public site: Raleway body + Cormorant Garamond display.
const sans = Raleway({ subsets: ["latin"], variable: "--font-sans-var" });
const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-display-var",
});

export const metadata: Metadata = {
  title: "Street Cats of Tavira",
  description:
    "Manage feral cat colonies, feeding operations and incidents for Street Cats of Tavira.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SCoT", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f7f4f2",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${sans.variable} ${display.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
