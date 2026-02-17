"use client";

import { Badge } from "@/components/ui/badge";
import { STATUS_CONFIG } from "@/lib/constants";
import type { DeviceStatus } from "@/types/device";
import { cn } from "@/lib/utils";

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;

  return (
    <Badge variant={config.variant} className="gap-1.5 text-xs">
      <span className={cn("size-1.5 rounded-full", config.dotClass)} />
      {config.label}
    </Badge>
  );
}
