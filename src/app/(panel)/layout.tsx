"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";
import { SafeModeProvider } from "@/contexts/SafeModeContext";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { I18nProvider } from "@/lib/i18n";
import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/servers": "Server Management",
  "/network": "Network Manager",
  "/apps": "Applications",
  "/deploy": "Deployment Assistant",
  "/terminal": "Terminal",
  "/audit": "Audit Log",
  "/settings": "Settings",
  "/users": "User Management",
  "/profile": "My Profile",
  "/backup": "Panel database backups",
  "/docs": "Docs",
};

function PanelContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  const pathname = usePathname();

  const title =
    pageTitles[pathname] ||
    Object.entries(pageTitles).find(([key]) =>
      pathname.startsWith(key)
    )?.[1] ||
    "VPS Control";

  return (
    <div className="flex h-screen h-[100dvh] overflow-hidden bg-gray-950">
      <Sidebar />
      <div
        className={`flex min-w-0 flex-1 flex-col overflow-hidden transition-all duration-300 ${collapsed ? "md:ml-16" : "md:ml-64"}`}
      >
          <Header title={title} />
          <main className="flex-1 overflow-y-auto p-4 pt-2 md:p-6">
            <Breadcrumbs />
            {children}
          </main>
      </div>
      {/* Command Palette */}
      <CommandPalette />
    </div>
  );
}

export default function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <I18nProvider>
      <SidebarProvider>
        <SafeModeProvider>
          <PanelContent>{children}</PanelContent>
        </SafeModeProvider>
      </SidebarProvider>
    </I18nProvider>
  );
}
