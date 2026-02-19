"use client";

import { use } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeviceInfoPanel } from "@/components/device-detail/device-info-panel";
import { DeviceActivityTimeline } from "@/components/device-detail/device-activity-timeline";
import { useDeviceStore } from "@/store/device-store";
import { useDevices } from "@/hooks/use-devices";
import { getWsBase } from "@/lib/api";

const DeviceScreen = dynamic(
  () => import("@/components/device-detail/device-screen"),
  { ssr: false }
);

export default function DeviceDetailPage({
  params,
}: {
  params: Promise<{ serial: string }>;
}) {
  const { serial } = use(params);
  // Fetch devices if the store is empty (direct navigation / page reload)
  useDevices();
  const devices = useDeviceStore((s) => s.devices);
  const device  = devices.find((d) => d.serial === serial);
  const wsBase  = getWsBase();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="size-8" asChild>
          <Link href="/devices">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {device?.model || serial}
          </h1>
          <p className="text-sm text-muted-foreground font-mono">{serial}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="p-4">
            <DeviceScreen serial={serial} wsBase={wsBase} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          {device && <DeviceInfoPanel device={device} />}
          <DeviceActivityTimeline />
        </div>
      </div>
    </div>
  );
}
