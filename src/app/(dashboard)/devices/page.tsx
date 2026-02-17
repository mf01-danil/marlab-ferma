"use client";

import { useMemo } from "react";
import { Smartphone, Loader2 } from "lucide-react";
import { useDeviceStore } from "@/store/device-store";
import { useDevices } from "@/hooks/use-devices";
import { DeviceToolbar } from "@/components/devices/device-toolbar";
import { DeviceGrid } from "@/components/devices/device-grid";
import { DeviceTable } from "@/components/devices/device-table";
import { BulkActionBar } from "@/components/devices/bulk-action-bar";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";

export default function DevicesPage() {
  const { isLoading, error } = useDevices();
  const { devices, viewMode, filter } = useDeviceStore();

  const filtered = useMemo(() => {
    let result = devices;

    if (filter.status !== "all") {
      result = result.filter((d) => d.status === filter.status);
    }
    if (filter.group !== "all") {
      result = result.filter((d) => d.group === filter.group);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (d) =>
          d.serial.toLowerCase().includes(q) ||
          d.model?.toLowerCase().includes(q) ||
          d.ipAddress?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [devices, filter]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Devices"
        description={`${devices.length} total devices, ${filtered.length} shown`}
      />

      <DeviceToolbar />

      {error ? (
        <EmptyState
          icon={Smartphone}
          title="Cannot connect to backend"
          description="Make sure the backend is running on port 3001."
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title="No devices found"
          description="Try adjusting your filters or search query."
        />
      ) : viewMode === "grid" ? (
        <DeviceGrid devices={filtered} />
      ) : (
        <DeviceTable devices={filtered} />
      )}

      <BulkActionBar />
    </div>
  );
}
