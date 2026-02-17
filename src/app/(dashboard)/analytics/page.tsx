"use client";

import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Device usage analytics and reports." />
      <EmptyState
        icon={BarChart3}
        title="No data yet"
        description="Analytics will appear once devices start reporting data."
      />
    </div>
  );
}
