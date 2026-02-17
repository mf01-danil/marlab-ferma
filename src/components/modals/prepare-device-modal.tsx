"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PrepareDeviceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceCount: number;
}

const STEPS = [
  { id: 1, title: "Checking ADB connection", description: "Verifying device connectivity" },
  { id: 2, title: "Pushing scrcpy server", description: "Uploading server binary to device" },
  { id: 3, title: "Starting stream", description: "Initializing video capture" },
];

export function PrepareDeviceModal({
  open,
  onOpenChange,
  deviceCount,
}: PrepareDeviceModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const handleStart = () => {
    setIsRunning(true);
    setCurrentStep(1);
    // Simulate step progression
    setTimeout(() => setCurrentStep(2), 1500);
    setTimeout(() => setCurrentStep(3), 3000);
    setTimeout(() => {
      setCurrentStep(4);
      setIsRunning(false);
    }, 4500);
  };

  const handleClose = () => {
    setCurrentStep(0);
    setIsRunning(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Prepare Devices</DialogTitle>
          <DialogDescription>
            Prepare {deviceCount} device{deviceCount > 1 ? "s" : ""} for
            streaming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {STEPS.map((step) => {
            const isActive = currentStep === step.id;
            const isDone = currentStep > step.id;

            return (
              <div key={step.id} className="flex items-start gap-3">
                <div className="mt-0.5">
                  {isDone ? (
                    <CheckCircle2 className="size-5 text-status-online" />
                  ) : isActive ? (
                    <Loader2 className="size-5 text-primary animate-spin" />
                  ) : (
                    <Circle className="size-5 text-muted-foreground/40" />
                  )}
                </div>
                <div>
                  <p
                    className={cn(
                      "text-sm font-medium",
                      !isActive && !isDone && "text-muted-foreground"
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          {currentStep === 4 ? (
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
