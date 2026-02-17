"use client";

import { FolderOpen } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";

export default function GroupsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Groups" description="Organize devices into groups." />
      <EmptyState
        icon={FolderOpen}
        title="No groups yet"
        description="Create groups to organize your devices."
      />
    </div>
  );
}
