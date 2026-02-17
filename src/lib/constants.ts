import {
  LayoutDashboard,
  Smartphone,
  Clock,
  ListTodo,
  FolderOpen,
  BarChart3,
  Settings,
} from "lucide-react";

export const NAV_ITEMS = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Devices", href: "/devices", icon: Smartphone },
  { title: "Sessions", href: "/sessions", icon: Clock },
  { title: "Tasks", href: "/tasks", icon: ListTodo },
  { title: "Groups", href: "/groups", icon: FolderOpen },
  { title: "Analytics", href: "/analytics", icon: BarChart3 },
  { title: "Settings", href: "/settings", icon: Settings },
] as const;

export const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; dotClass: string }> = {
  device: { label: "Online", variant: "default", dotClass: "bg-status-online" },
  offline: { label: "Offline", variant: "secondary", dotClass: "bg-status-offline" },
  unauthorized: { label: "Unauthorized", variant: "destructive", dotClass: "bg-status-error" },
  "no permissions": { label: "No Permissions", variant: "destructive", dotClass: "bg-status-error" },
  preparing: { label: "Preparing", variant: "outline", dotClass: "bg-status-busy" },
  busy: { label: "Busy", variant: "outline", dotClass: "bg-status-busy" },
  error: { label: "Error", variant: "destructive", dotClass: "bg-status-error" },
};

export const DEVICE_GROUPS = ["Production", "Testing", "Development", "Staging", "QA"] as const;
