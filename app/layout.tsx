import type { Metadata, Viewport } from "next";
import { Oswald, Geist_Mono, Courier_Prime } from "next/font/google";
import "./globals.css";
import { getCurrentIdentity } from "@/lib/game-session/identity";
import { getStore } from "@/lib/game-session/persistence";

const displayFont = Oswald({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const documentFont = Courier_Prime({
  variable: "--font-document",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "CASELINE",
  description: "Système d'enquête policière",
};

// `viewportFit: "cover"` is required for env(safe-area-inset-*) to report
// real values on iPhone (notch/Dynamic Island/home indicator) instead of 0.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const identity = await getCurrentIdentity();
  const reduceMotion = identity.authenticated ? (await getStore().getProfile(identity.userId)).settings.reduceMotion : false;

  return (
    <html
      lang="fr"
      data-reduce-motion={reduceMotion ? "true" : "false"}
      className={`${displayFont.variable} ${geistMono.variable} ${documentFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
