import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crésus — Rentabilité quotidienne · Arte Collective",
  description:
    "Analyse financière jour par jour et heure par heure : Shopify, POD, Qonto, Meta, TVA et impôts centralisés.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-ink text-[#e6e9ef] font-sans antialiased">{children}</body>
    </html>
  );
}
