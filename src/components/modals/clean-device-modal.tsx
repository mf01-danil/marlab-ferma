"use client";

import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface CleanDeviceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceCount: number;
}

export function CleanDeviceModal({
  open,
  onOpenChange,
  deviceCount,
}: CleanDeviceModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 mb-2">
            <AlertTriangle className="size-6 text-destructive" />
          </div>
          <DialogTitle className="text-center">Clean Devices</DialogTitle>
          <DialogDescription className="text-center">
            This will remove all data, installed apps, and cached files from{" "}
            <span className="font-semibold text-foreground">
              {deviceCount} device{deviceCount > 1 ? "s" : ""}
            </span>
            . This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Clean {deviceCount} Device{deviceCount > 1 ? "s" : ""}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
