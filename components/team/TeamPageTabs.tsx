"use client";

import { useState } from "react";

import { Tabs } from "@/components/ui/Tabs";
import { TeamDirectory } from "@/components/team/TeamDirectory";
import { TeamManager } from "@/components/team/TeamManager";

/**
 * /team: the directory for everyone who may open the page, and — for the
 * founder only — the account management that already lived here.
 */
export function TeamPageTabs({ currentUserId, canManage }: { currentUserId: string; canManage: boolean }) {
  const [tab, setTab] = useState<"directory" | "accounts">("directory");

  if (!canManage) return <TeamDirectory />;

  return (
    <div className="space-y-6">
      <Tabs
        items={[
          { key: "directory", label: "Directory" },
          { key: "accounts", label: "Accounts" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "directory" ? <TeamDirectory /> : <TeamManager currentUserId={currentUserId} />}
    </div>
  );
}
