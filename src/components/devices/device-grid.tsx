"use client";

import { DeviceCard } from "./device-card";
import type { Device } from "@/types/device";

interface DeviceGridProps {
  devices: Device[];
}

export function DeviceGrid({ devices }: DeviceGridProps) {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {devices.map((device) => (
        <DeviceCard key={device.serial} device={device} />
      ))}
    </div>
  );
}
