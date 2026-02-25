"use client";

import { ReactNode } from "react";
import clsx from "clsx";

export interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (key: string) => void;
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="-mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto scrollbar-hide mb-6">
      <div className="flex gap-1 border-b border-gray-700 min-w-max">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={clsx(
              "flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px sm:gap-2 sm:px-4",
              activeTab === tab.key
                ? "border-brand-500 text-white"
                : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600"
            )}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
