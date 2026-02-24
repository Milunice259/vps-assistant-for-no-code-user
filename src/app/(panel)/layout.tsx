"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { I18nProvider } from "@/lib/i18n";
import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/servers": "Server Management",
  "/network": "Network Manager",
  "/apps": "Applications",
  "/deploy": "GitHub Deployer",
  "/terminal": "Terminal",
  "/audit": "Audit Log",
  "/settings": "Settings",
  "/users": "User Management",
  "/backup": "Database Backups",
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
        className="flex min-w-0 flex-1 flex-col overflow-hidden transition-all duration-300 md:ml-16"
        style={{ marginLeft: undefined }}
      >
        {/* Desktop: use inline style for margin; Mobile: no margin */}
        <div
          className="hidden md:flex md:flex-1 md:flex-col md:overflow-hidden"
          style={{ marginLeft: collapsed ? "4rem" : "16rem" }}
        >
          <Header title={title} />
          <main className="flex-1 overflow-y-auto p-6">
            <Breadcrumbs />
            {children}
          </main>
        </div>
        {/* Mobile: no sidebar margin, add top padding for hamburger */}
        <div className="flex flex-1 flex-col overflow-hidden md:hidden">
          <Header title={title} />
          <main className="flex-1 overflow-y-auto p-4 pt-2">
            <Breadcrumbs />
            {children}
          </main>
        </div>
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
        <PanelContent>{children}</PanelContent>
      </SidebarProvider>
    </I18nProvider>
  );
}
