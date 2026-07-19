// assets/js/permissions.js
import { getIdentity } from "./auth.js";

// Route -> roles allowed. 'staff' and 'firm_admin' are the only two roles.
export const ROUTE_ACCESS = {
  "/dashboard": ["firm_admin", "staff"],
  "/clients": ["firm_admin", "staff"],
  "/work-orders": ["firm_admin", "staff"],
  "/resources": ["firm_admin", "staff"],
  "/ai-bot": ["firm_admin", "staff"],
  "/users": ["firm_admin"],
  "/settings": ["firm_admin"],
  "/workspace": ["firm_admin", "staff"],
  "/isqm": ["firm_admin", "staff"],
  "/change-password": ["firm_admin", "staff"],
  "/account-security": ["firm_admin", "staff"],
};

export function canAccess(route) {
  const identity = getIdentity();
  if (!identity || !identity.role) return false;
  const allowed = ROUTE_ACCESS[route];
  if (!allowed) return false;
  return allowed.includes(identity.role);
}

export function isFirmAdmin() {
  return getIdentity()?.role === "firm_admin";
}

export const SIDEBAR_ITEMS = [
  { route: "/dashboard", label: "Dashboard", icon: "layout-dashboard", roles: ["firm_admin", "staff"] },
  { route: "/clients", label: "Client List", icon: "users", roles: ["firm_admin", "staff"] },
  { route: "/work-orders", label: "Work Orders", icon: "clipboard-list", roles: ["firm_admin", "staff"] },
  { route: "/resources", label: "Resources", icon: "folder", roles: ["firm_admin", "staff"] },
  { route: "/ai-bot", label: "AI Bot", icon: "bot", roles: ["firm_admin", "staff"] },
  { route: "/isqm", label: "ISQM", icon: "shield-check", roles: ["firm_admin", "staff"] },
  { route: "/users", label: "User Management", icon: "user-cog", roles: ["firm_admin"] },
  { route: "/settings", label: "Firm Settings", icon: "settings", roles: ["firm_admin"] },
  { route: "/workspace", label: "Virtual Workspace", icon: "building-2", roles: ["firm_admin", "staff"] },
];

export function visibleSidebarItems() {
  const identity = getIdentity();
  if (!identity || !identity.role) return [];
  return SIDEBAR_ITEMS.filter((item) => item.roles.includes(identity.role));
}
