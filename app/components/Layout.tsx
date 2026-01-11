import { Link, useLocation } from "@tanstack/react-router";
import {
  FileText,
  Users,
  LayoutDashboard,
  Upload,
  ChevronRight,
} from "lucide-react";
import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg-root)" }}>
      <Header />
      <main className="max-w-6xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}

function Header() {
  const location = useLocation();
  const currentPath = location.pathname;

  const navItems = [
    { path: "/", label: "Dashboard", icon: LayoutDashboard },
    { path: "/articles", label: "Articles", icon: FileText },
    { path: "/authors", label: "Authors", icon: Users },
    { path: "/import", label: "Import", icon: Upload },
  ];

  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: "var(--bg-surface)",
        borderBottom: "0.5px solid var(--border-default)",
      }}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo / Brand */}
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center text-white font-semibold text-xs"
                style={{ background: "var(--fg-default)" }}
              >
                OTE
              </div>
              <span
                className="font-semibold text-sm hidden sm:block"
                style={{ color: "var(--fg-default)", letterSpacing: "-0.01em" }}
              >
                Over the Edge
              </span>
            </Link>

            {/* Separator */}
            <div
              className="hidden sm:block h-5 w-px"
              style={{ background: "var(--border-default)" }}
            />

            {/* Navigation */}
            <nav className="flex items-center gap-1">
              {navItems.map(({ path, label, icon: Icon }) => {
                const isActive =
                  path === "/" ? currentPath === "/" : currentPath.startsWith(path);

                return (
                  <Link
                    key={path}
                    to={path}
                    className={`nav-item ${isActive ? "nav-item-active" : ""}`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="hidden sm:inline">{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right side - could add user menu, search, etc. */}
          <div className="flex items-center gap-2">
            <span
              className="text-xs px-2 py-1 rounded"
              style={{
                background: "var(--bg-subtle)",
                color: "var(--fg-muted)",
              }}
            >
              v1.0
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

// ===========================================
// Status Badge - Minimal color, status-driven
// ===========================================
const STATUS_STYLES: Record<string, { badge: string; dot?: string }> = {
  Draft: { badge: "badge-default" },
  "Pending Review": { badge: "badge-pending" },
  "In Review": { badge: "badge-info" },
  "Needs Revision": { badge: "badge-warning" },
  Approved: { badge: "badge-success" },
  "In Editing": { badge: "badge-info" },
  "Ready for Publication": { badge: "badge-success" },
  Published: { badge: "badge-success" },
  Archived: { badge: "badge-default" },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || { badge: "badge-default" };

  return <span className={`badge ${style.badge}`}>{status}</span>;
}

// ===========================================
// Tier Badge - Monospace, subtle differentiation
// ===========================================
export function TierBadge({ tier }: { tier: string }) {
  // Extract tier number for display
  const tierNum = tier.match(/Tier (\d)/)?.[1] || "?";

  return (
    <span className="badge badge-tier" title={tier}>
      T{tierNum}
    </span>
  );
}

// ===========================================
// Empty State - Clean, centered
// ===========================================
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon className="empty-state-icon" />
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ===========================================
// Stat Card - Clean, monochrome
// ===========================================
export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  href,
}: {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  trend?: { value: number; label: string };
  href?: string;
}) {
  const content = (
    <div className="stat-card group">
      <div className="flex items-start justify-between">
        <div>
          <div className="stat-value">{value}</div>
          <div className="stat-label">{title}</div>
        </div>
        <div className="icon-container">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      {trend && (
        <div
          className="mt-3 text-xs flex items-center gap-1"
          style={{ color: "var(--fg-muted)" }}
        >
          <span
            style={{
              color: trend.value >= 0 ? "var(--status-success)" : "var(--status-error)",
            }}
          >
            {trend.value >= 0 ? "+" : ""}
            {trend.value}
          </span>
          <span>{trend.label}</span>
        </div>
      )}
      {href && (
        <div
          className="mt-3 text-xs flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--accent)" }}
        >
          <span>View all</span>
          <ChevronRight className="w-3 h-3" />
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link to={href} className="block">
        {content}
      </Link>
    );
  }

  return content;
}

// ===========================================
// Format Helpers
// ===========================================
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return formatDate(d);
}

// ===========================================
// Loading Spinner
// ===========================================
export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };

  return (
    <div
      className={`animate-spin rounded-full border-2 border-current border-t-transparent ${sizes[size]}`}
      style={{ color: "var(--fg-faint)" }}
    />
  );
}

// ===========================================
// Section Component
// ===========================================
export function Section({
  title,
  action,
  children,
  noPadding,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  noPadding?: boolean;
}) {
  return (
    <div className="section">
      {title && (
        <div className="section-header">
          <h2 className="section-title">{title}</h2>
          {action}
        </div>
      )}
      <div className={noPadding ? "" : "section-content"}>{children}</div>
    </div>
  );
}

// ===========================================
// Avatar Component
// ===========================================
export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md";
}) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className={`avatar ${size === "sm" ? "avatar-sm" : ""}`}>{initials}</div>
  );
}

// ===========================================
// Button Components
// ===========================================
export function Button({
  children,
  variant = "secondary",
  size = "md",
  disabled,
  onClick,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
}) {
  const variants = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    ghost: "btn-ghost",
  };

  const sizes = {
    sm: "text-xs px-2 py-1",
    md: "",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`btn ${variants[variant]} ${sizes[size]} ${className} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      {children}
    </button>
  );
}

// ===========================================
// Input Component
// ===========================================
export function Input({
  placeholder,
  value,
  onChange,
  type = "text",
  icon: Icon,
  className = "",
}: {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "search";
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      {Icon && (
        <Icon
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
          style={{ color: "var(--fg-faint)" }}
        />
      )}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input ${Icon ? "pl-9" : ""}`}
      />
    </div>
  );
}

// ===========================================
// Select Component (styled trigger)
// ===========================================
export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="select-trigger"
      style={{ appearance: "none", paddingRight: "28px" }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ===========================================
// Icon Button
// ===========================================
export function IconButton({
  icon: Icon,
  label,
  onClick,
  variant = "ghost",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  variant?: "ghost" | "secondary";
}) {
  return (
    <button
      onClick={onClick}
      className={`btn ${variant === "ghost" ? "btn-ghost" : "btn-secondary"} !p-2`}
      title={label}
      aria-label={label}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
