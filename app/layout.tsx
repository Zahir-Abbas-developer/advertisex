import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";

import "./globals.css";
import { Providers } from "@/components/Providers";

/** Display face — headings, wordmark, eyebrow labels, stat figures. */
const display = Inter_Tight({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

/** Body face — everything else. */
const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: {
    default: "Advertise X",
    template: "%s · Advertise X",
  },
  description:
    "Department-based CRM and internal business operating system for Advertise X — leads, clients, deals, tasks and follow-ups across every business line.",
  // Installable, so an availability check can reach a phone's notification
  // tray rather than depending on a browser tab being open.
  manifest: "/manifest.webmanifest",
  applicationName: "Advertise X",
  appleWebApp: {
    capable: true,
    title: "Advertise X",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0B0D",
  // The app is a real working surface on a phone; letting iOS zoom the layout
  // on an input focus makes answering a check fiddly.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-screen bg-base text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
