"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { DeviceStatusBadge } from "./device-status-badge";
import { useDeviceStore } from "@/store/device-store";
import type { Device } from "@/types/device";

interface DeviceTableProps {
  devices: Device[];
}

export function DeviceTable({ devices }: DeviceTableProps) {
  const { selectedIds, toggleSelect, selectAll, clearSelection } =
    useDeviceStore();
  const allSelected =
    devices.length > 0 && devices.every((d) => selectedIds.has(d.serial));

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => {
                  if (checked) {
                    selectAll(devices.map((d) => d.serial));
                  } else {
                    clearSelection();
                  }
                }}
              />
            </TableHead>
            <TableHead>Serial</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Group</TableHead>
            <TableHead>Battery</TableHead>
            <TableHead>Android</TableHead>
            <TableHead>IP Address</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {devices.map((device) => (
            <TableRow
              key={device.serial}
              data-state={selectedIds.has(device.serial) ? "selected" : undefined}
            >
              <TableCell>
                <Checkbox
                  checked={selectedIds.has(device.serial)}
                  onCheckedChange={() => toggleSelect(device.serial)}
                />
              </TableCell>
              <TableCell>
                <Link
                  href={`/device/${device.serial}`}
                  className="font-medium text-primary hover:underline"
                >
                  {device.serial}
                </Link>
              </TableCell>
              <TableCell>{device.model || "—"}</TableCell>
              <TableCell>
                <DeviceStatusBadge status={device.status} />
              </TableCell>
              <TableCell>{device.group || "—"}</TableCell>
              <TableCell>
                {device.battery !== undefined ? `${device.battery}%` : "—"}
              </TableCell>
              <TableCell>{device.androidVersion || "—"}</TableCell>
              <TableCell className="text-muted-foreground">
                {device.ipAddress || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
