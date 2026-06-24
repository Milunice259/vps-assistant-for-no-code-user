import type { Metadata } from "next";
import "./globals.css";
import "@/lib/notification-scheduler";

export const metadata: Metadata = {
  title: "VPS Control App",
  description: "A friendly self-hosted VPS assistant for monitoring, alerts, backups, deploys, and safe repairs.",
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gray-950">{children}</body>
    </html>
  );
}
