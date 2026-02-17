"use client";

import { Clock } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";

export default function SessionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Sessions" description="Active streaming sessions." />
      <EmptyState
        icon={Clock}
        title="No active sessions"
        description="Sessions will appear here when devices start streaming."
      />
    </div>
  );
}
