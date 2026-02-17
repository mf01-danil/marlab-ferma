"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Download,
  PackageCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  usePrepareJob,
  type DeviceProgress,
  type FileProgress,
} from "@/hooks/use-prepare-job";

interface PrepareDeviceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serials: string[];
}

function FileStatusIcon({ status }: { status: FileProgress["status"] }) {
  switch (status) {
    case "installed":
      return <PackageCheck className="size-3.5 text-status-online" />;
    case "loaded":
      return <CheckCircle2 className="size-3.5 text-status-online" />;
    case "installing":
      return <Download className="size-3.5 text-primary animate-pulse" />;
    case "uploading":
      return <Loader2 className="size-3.5 text-primary animate-spin" />;
    case "failed":
      return <XCircle className="size-3.5 text-destructive" />;
    default:
      return <Circle className="size-3.5 text-muted-foreground/40" />;
  }
}

function DeviceStatusIcon({ status }: { status: DeviceProgress["status"] }) {
  switch (status) {
    case "prepared":
      return <CheckCircle2 className="size-4 text-status-online" />;
    case "preparing":
      return <Loader2 className="size-4 text-primary animate-spin" />;
    case "failed":
      return <XCircle className="size-4 text-destructive" />;
    default:
      return <Circle className="size-4 text-muted-foreground/40" />;
  }
}

function DeviceRow({ dp }: { dp: DeviceProgress }) {
  const [expanded, setExpanded] = useState(false);
  const hasFiles = dp.files.length > 0;

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => hasFiles && setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
      >
        <DeviceStatusIcon status={dp.status} />
        <span className="flex-1 font-mono text-xs truncate">{dp.serial}</span>
        {dp.status === "failed" && dp.error && (
          <span className="text-xs text-destructive truncate max-w-[200px]">
            {dp.error}
          </span>
        )}
        {hasFiles &&
          (expanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          ))}
      </button>
      {expanded && hasFiles && (
        <div className="pl-9 pr-3 pb-2 space-y-1">
          {dp.files.map((f) => (
            <div key={f.name} className="flex items-center gap-2 text-xs">
              <FileStatusIcon status={f.status} />
              <span className="text-muted-foreground">{f.name}</span>
              {f.error && (
                <span className="text-destructive truncate ml-auto">
                  {f.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PrepareDeviceModal({
  open,
  onOpenChange,
  serials,
}: PrepareDeviceModalProps) {
  const { devices, jobStatus, isRunning, isDone, error, startJob, reset } =
    usePrepareJob();

  const handleStart = () => {
    startJob(serials);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const deviceList = Array.from(devices.values());
  const prepared = deviceList.filter((d) => d.status === "prepared").length;
  const failed = deviceList.filter((d) => d.status === "failed").length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prepare Devices</DialogTitle>
          <DialogDescription>
            {!jobStatus
              ? `Push files & install APKs on ${serials.length} device${serials.length > 1 ? "s" : ""}.`
              : isRunning
                ? "Pushing files & installing APKs..."
                : jobStatus === "completed"
                  ? `All ${prepared} device${prepared > 1 ? "s" : ""} prepared successfully.`
                  : `Finished with ${failed} error${failed > 1 ? "s" : ""}.`}
          </DialogDescription>
        </DialogHeader>

        {error && !isDone && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {deviceList.length > 0 && (
          <ScrollArea className="max-h-[300px]">
            <div className="rounded-md border">
              {deviceList.map((dp) => (
                <DeviceRow key={dp.serial} dp={dp} />
              ))}
            </div>
          </ScrollArea>
        )}

        {isDone && (
          <div className="flex items-center gap-2 text-sm">
            {jobStatus === "completed" ? (
              <>
                <CheckCircle2 className="size-4 text-status-online" />
                <span>All devices prepared</span>
              </>
            ) : (
              <>
                <XCircle className="size-4 text-destructive" />
                <span>
                  {prepared} prepared, {failed} failed
                </span>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {isDone ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <Button onClick={handleStart} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Preparing...
                </>
              ) : (
                "Start"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
