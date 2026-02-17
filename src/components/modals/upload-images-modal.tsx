"use client";

import { useState, useCallback } from "react";
import { Upload, ImagePlus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface UploadImagesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceCount: number;
}

export function UploadImagesModal({
  open,
  onOpenChange,
  deviceCount,
}: UploadImagesModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/")
    );
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClose = () => {
    setFiles([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Images</DialogTitle>
          <DialogDescription>
            Upload images to {deviceCount} device{deviceCount > 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div
          className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
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
          <div className="relative space-y-2">
            <ImagePlus className="mx-auto size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Drop images here</p>
            <p className="text-xs text-muted-foreground">PNG, JPG, WEBP</p>
            <input
              type="file"
              accept="image/*"
              multiple
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(e) => {
                const selected = Array.from(e.target.files || []);
                setFiles((prev) => [...prev, ...selected]);
              }}
            />
          </div>
        </div>

        {files.length > 0 && (
          <div className="grid grid-cols-4 gap-2 max-h-48 overflow-auto">
            {files.map((file, i) => (
              <div key={i} className="group relative aspect-square rounded-md overflow-hidden bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="size-full object-cover"
                />
                <button
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => removeFile(i)}
                >
                  <X className="size-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button disabled={files.length === 0}>
            <Upload className="mr-2 size-4" />
            Upload {files.length > 0 && `(${files.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
