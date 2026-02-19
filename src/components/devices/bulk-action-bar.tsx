"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Play, Trash2, Download, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeviceStore } from "@/store/device-store";
export function BulkActionBar() {
  const { selectedIds, clearSelection } = useDeviceStore();
  const count = selectedIds.size;

  return (
    <>
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
          >
            <div className="flex items-center gap-3 rounded-xl border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <span className="text-sm font-medium whitespace-nowrap">
                {count} selected
              </span>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-8 gap-1.5">
                  <Download className="size-3.5" />
                  Install APK
                </Button>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5">
                  <ImagePlus className="size-3.5" />
                  Upload
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                  Clean
                </Button>
              </div>
              <div className="h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={clearSelection}
              >
                <X className="size-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </>
  );
}
