"use client";

import { useState, useEffect } from "react";
import { Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { toast } from "sonner";

export default function SettingsPage() {
  const [apiUrl, setApiUrl] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("marlab_api_url");
    if (saved) setApiUrl(saved);
  }, []);

  const handleSave = () => {
    if (apiUrl.trim()) {
      localStorage.setItem("marlab_api_url", apiUrl.trim());
    } else {
      localStorage.removeItem("marlab_api_url");
    }
    toast.success("Settings saved");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure your phone farm connection."
      />

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Backend URL</CardTitle>
          <CardDescription>
            The URL of your MarLab backend server. Leave empty to auto-detect
            from current hostname.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-url">API URL</Label>
            <Input
              id="api-url"
              placeholder="http://192.168.1.100:3001"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Example: http://192.168.1.100:3001
            </p>
          </div>
          <Button onClick={handleSave} className="gap-1.5">
            <Save className="size-4" />
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
