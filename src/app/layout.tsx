import type { Metadata } from "next";
import "./globals.css";
import "@/lib/notification-scheduler";

import { getGeneralSettings } from "@/lib/general-settings";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { applicationName } = await getGeneralSettings();
  return {
  title: applicationName,
  description: "A friendly self-hosted VPS assistant for monitoring, alerts, backups, deploys, and safe repairs.",
  icons: { icon: "/logo.svg" },
  };
}

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
