"use client";

import { useState, useCallback } from "react";
import { Upload, File, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface InstallApkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceCount: number;
}

export function InstallApkModal({
  open,
  onOpenChange,
  deviceCount,
}: InstallApkModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith(".apk")) {
      setFile(droppedFile);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const handleClose = () => {
    setFile(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install APK</DialogTitle>
          <DialogDescription>
            Install an APK on {deviceCount} device{deviceCount > 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div
          className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <File className="size-8 text-primary" />
              <div className="text-left">
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setFile(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload className="mx-auto size-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Drop APK file here</p>
                <p className="text-xs text-muted-foreground">or click to browse</p>
              </div>
              <input
                type="file"
                accept=".apk"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={handleFileSelect}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button disabled={!file}>Install</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
