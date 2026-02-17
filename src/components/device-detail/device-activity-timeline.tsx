"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MOCK_ACTIVITY = [
  { time: "2 min ago", event: "Stream started", type: "info" as const },
  { time: "5 min ago", event: "Device connected", type: "success" as const },
  { time: "15 min ago", event: "APK installed: com.example.app", type: "info" as const },
  { time: "1 hour ago", event: "Device rebooted", type: "warning" as const },
  { time: "3 hours ago", event: "Images uploaded (12 files)", type: "info" as const },
];

const TYPE_COLORS = {
  info: "bg-primary",
  success: "bg-status-online",
  warning: "bg-status-busy",
  error: "bg-status-error",
};

export function DeviceActivityTimeline() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {MOCK_ACTIVITY.map((item, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`size-2 rounded-full mt-1.5 ${TYPE_COLORS[item.type]}`} />
                {i < MOCK_ACTIVITY.length - 1 && (
                  <div className="w-px flex-1 bg-border mt-1" />
                )}
              </div>
              <div className="pb-4">
                <p className="text-sm">{item.event}</p>
                <p className="text-xs text-muted-foreground">{item.time}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
