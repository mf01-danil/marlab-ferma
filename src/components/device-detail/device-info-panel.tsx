"use client";

import {
  Battery,
  Cpu,
  Globe,
  Smartphone,
  Play,
  Trash2,
  Download,
  ImagePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DeviceStatusBadge } from "@/components/devices/device-status-badge";
import type { Device } from "@/types/device";

interface DeviceInfoPanelProps {
  device: Device;
}

export function DeviceInfoPanel({ device }: DeviceInfoPanelProps) {
  const specs = [
    { icon: Smartphone, label: "Model", value: device.model || "Unknown" },
    { icon: Cpu, label: "Android", value: device.androidVersion || "—" },
    { icon: Battery, label: "Battery", value: device.battery !== undefined ? `${device.battery}%` : "—" },
    { icon: Globe, label: "IP Address", value: device.ipAddress || "—" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Device Info</CardTitle>
            <DeviceStatusBadge status={device.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground font-mono">
            {device.serial}
          </div>
          {device.group && (
            <div className="text-sm">
              <span className="text-muted-foreground">Group:</span>{" "}
              <span className="font-medium">{device.group}</span>
            </div>
          )}
          <Separator />
          <div className="space-y-2">
            {specs.map((spec) => (
              <div key={spec.label} className="flex items-center gap-2 text-sm">
                <spec.icon className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">{spec.label}</span>
                <span className="ml-auto font-medium">{spec.value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="size-3.5" />
            Install APK
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5">
            <ImagePlus className="size-3.5" />
            Upload
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Clean
          </Button>
        </CardContent>
      </Card>

    </div>
  );
}
