import type { Metadata, Viewport } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServiceWorkerRegister } from "@/components/pwa/pwa";
import "./globals.css";

// Tipografía de la marca (chipacheese.com.ar usa Poppins).
const poppins = Poppins({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Chipa Cheese — Gestión", template: "%s · Chipa Cheese" },
  description: "Sistema de gestión de Pacon SRL (Chipa Cheese)",
  applicationName: "Chipa Cheese",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/brand/isotipo.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#E54E2F", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-AR"
      className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-center" />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
