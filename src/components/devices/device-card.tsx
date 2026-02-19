"use client";

import Link from "next/link";
import {
  Smartphone,
  MoreVertical,
  Play,
  Trash2,
  Download,
  ImagePlus,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { DeviceStatusBadge } from "./device-status-badge";
import { useDeviceStore } from "@/store/device-store";
import type { Device } from "@/types/device";
import { cn } from "@/lib/utils";

interface DeviceCardProps {
  device: Device;
}

export function DeviceCard({ device }: DeviceCardProps) {
  const { selectedIds, toggleSelect } = useDeviceStore();
  const isSelected = selectedIds.has(device.serial);
  return (
    <>
      <Card
        className={cn(
          "group relative transition-all hover:shadow-md",
          isSelected && "ring-2 ring-primary"
        )}
      >
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSelect(device.serial)}
              className="opacity-0 group-hover:opacity-100 data-[state=checked]:opacity-100 transition-opacity"
            />
            <DeviceStatusBadge status={device.status} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/device/${device.serial}`}>
                  <Play className="mr-2 size-4" />
                  Open Stream
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Download className="mr-2 size-4" />
                Install APK
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ImagePlus className="mr-2 size-4" />
                Upload Images
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive">
                <Trash2 className="mr-2 size-4" />
                Clean Device
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent>
          <Link
            href={`/device/${device.serial}`}
            className="block space-y-2"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <Smartphone className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {device.model || "Unknown"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {device.serial}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground pt-1">
              {device.group && (
                <span>Group: {device.group}</span>
              )}
              {device.battery !== undefined && (
                <span>Battery: {device.battery}%</span>
              )}
              {device.androidVersion && (
                <span>Android {device.androidVersion}</span>
              )}
              {device.ipAddress && <span>{device.ipAddress}</span>}
            </div>
          </Link>
        </CardContent>
      </Card>

    </>
  );
}
