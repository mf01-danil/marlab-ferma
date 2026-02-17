"use client";

import { Search, LayoutGrid, List, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDeviceStore } from "@/store/device-store";
import { DEVICE_GROUPS } from "@/lib/constants";
import type { DeviceStatus, ViewMode } from "@/types/device";

export function DeviceToolbar() {
  const { viewMode, filter, setViewMode, setFilter } = useDeviceStore();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search devices..."
            value={filter.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            className="pl-9"
          />
        </div>
        <Select
          value={filter.status}
          onValueChange={(val) =>
            setFilter({ status: val as DeviceStatus | "all" })
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="device">Online</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
            <SelectItem value="busy">Busy</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filter.group}
          onValueChange={(val) => setFilter({ group: val })}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {DEVICE_GROUPS.map((group) => (
              <SelectItem key={group} value={group}>
                {group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="size-8">
          <RefreshCw className="size-4" />
        </Button>
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(val) => {
            if (val) setViewMode(val as ViewMode);
          }}
        >
          <ToggleGroupItem value="grid" aria-label="Grid view" className="size-8 p-0">
            <LayoutGrid className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table view" className="size-8 p-0">
            <List className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}
