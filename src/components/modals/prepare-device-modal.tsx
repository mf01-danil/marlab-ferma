"use client";

import { useState, useRef, useEffect } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Download,
  PackageCheck,
  Wifi,
  Shield,
  RotateCcw,
  Terminal,
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
  type SetupStep,
  type LogEntry,
} from "@/hooks/use-prepare-job";
import { cn } from "@/lib/utils";

interface PrepareDeviceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serials: string[];
}

const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  "checking-magisk": "Checking Kitsune Mask...",
  "connecting-wifi": "Connecting WiFi...",
  "waiting-internet": "Waiting for internet...",
  "checking-root": "Checking root...",
  "awaiting-magisk-update": "Awaiting Magisk update...",
  "enabling-zygisk": "Enabling Zygisk...",
  "installing-modules": "Installing modules...",
  "rebooting": "Rebooting...",
  "waiting-boot": "Waiting for boot...",
};

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

function SetupStepIcon({ step }: { step: SetupStep }) {
  switch (step) {
    case "connecting-wifi":
    case "waiting-internet":
      return <Wifi className="size-3 text-primary" />;
    case "checking-root":
    case "checking-magisk":
    case "enabling-zygisk":
      return <Shield className="size-3 text-primary" />;
    case "awaiting-magisk-update":
      return <Shield className="size-3 text-yellow-600 dark:text-yellow-500 animate-pulse" />;
    case "rebooting":
    case "waiting-boot":
      return <RotateCcw className="size-3 text-primary animate-spin" />;
    default:
      return <Loader2 className="size-3 text-primary animate-spin" />;
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function LogPanel({ logs }: { logs: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className="rounded-md border bg-muted/30 font-mono text-[11px] leading-relaxed max-h-[160px] overflow-y-auto p-2">
      {logs.length === 0 && (
        <span className="text-muted-foreground">Waiting for events...</span>
      )}
      {logs.map((entry, i) => (
        <div key={i} className="flex gap-1.5">
          <span className="text-muted-foreground/60 shrink-0">{formatTime(entry.time)}</span>
          {entry.serial && (
            <span className="text-muted-foreground shrink-0">[{entry.serial.slice(-6)}]</span>
          )}
          <span
            className={cn(
              entry.level === "error" && "text-destructive",
              entry.level === "success" && "text-status-online",
              entry.level === "warn" && "text-yellow-600 dark:text-yellow-500",
              entry.level === "info" && "text-foreground/80",
            )}
          >
            {entry.message}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
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
        {dp.status === "preparing" && dp.setupStep && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <SetupStepIcon step={dp.setupStep} />
            <span>{SETUP_STEP_LABELS[dp.setupStep]}</span>
            {dp.setupMessage && (
              <span className="text-primary">{dp.setupMessage}</span>
            )}
          </span>
        )}
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
  const { devices, logs, jobStatus, isRunning, isDone, error, startJob, reset } =
    usePrepareJob();
  const [showLog, setShowLog] = useState(true);

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
              ? `Push files, install APKs & setup Magisk on ${serials.length} device${serials.length > 1 ? "s" : ""}.`
              : isRunning
                ? "Pushing files, installing APKs & configuring Magisk..."
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
          <ScrollArea className="max-h-[200px]">
            <div className="rounded-md border">
              {deviceList.map((dp) => (
                <DeviceRow key={dp.serial} dp={dp} />
              ))}
            </div>
          </ScrollArea>
        )}

        {(isRunning || isDone) && (
          <div>
            <button
              onClick={() => setShowLog(!showLog)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1.5"
            >
              <Terminal className="size-3" />
              <span>Log ({logs.length})</span>
              {showLog ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
            {showLog && <LogPanel logs={logs} />}
          </div>
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
