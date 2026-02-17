"use client";

import { Smartphone, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeviceStore } from "@/store/device-store";

export default function DashboardPage() {
  const devices = useDeviceStore((s) => s.devices);

  const online = devices.filter((d) => d.status === "device").length;
  const offline = devices.filter((d) => d.status === "offline").length;
  const errors = devices.filter((d) =>
    ["error", "unauthorized", "no permissions"].includes(d.status)
  ).length;

  const stats = [
    {
      title: "Total Devices",
      value: devices.length,
      icon: Smartphone,
      description: "Registered devices",
    },
    {
      title: "Online",
      value: online,
      icon: Wifi,
      description: `${((online / devices.length) * 100).toFixed(0)}% availability`,
    },
    {
      title: "Offline",
      value: offline,
      icon: WifiOff,
      description: "Disconnected devices",
    },
    {
      title: "Errors",
      value: errors,
      icon: AlertTriangle,
      description: "Need attention",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your phone farm status.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.title}
              </CardTitle>
              <stat.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
