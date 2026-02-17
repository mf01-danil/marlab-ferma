"use client";

import { ListTodo } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" description="Scheduled and running tasks." />
      <EmptyState
        icon={ListTodo}
        title="No tasks"
        description="Create tasks to automate device operations."
      />
    </div>
  );
}
