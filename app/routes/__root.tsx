/// <reference types="vite/client" />
import {
  Link,
  Outlet,
  ScrollRestoration,
  createRootRoute,
  useLocation,
  useRouterState,
} from "@tanstack/react-router";
import { Meta, Scripts } from "@tanstack/start";
import type { ReactNode } from "react";
import {
  FileText,
  Users,
  LayoutDashboard,
  Wrench,
  Loader2,
  Settings,
  BarChart3,
} from "lucide-react";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "OTE Manager - Over the Edge Article Management" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function NotFoundComponent() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div
        className="text-6xl font-bold mb-2"
        style={{ color: "var(--fg-faint)" }}
      >
        404
      </div>
      <div className="text-lg mb-4" style={{ color: "var(--fg-muted)" }}>
        Page not found
      </div>
      <Link
        to="/"
        className="text-sm font-medium px-4 py-2 rounded-lg"
        style={{
          background: "var(--accent)",
          color: "white",
        }}
      >
        Go to Dashboard
      </Link>
    </div>
  );
}

function RootComponent() {
  const isLoading = useRouterState({ select: (s) => s.isLoading });

  return (
    <RootDocument>
      <div className="min-h-screen" style={{ background: "var(--bg-root)" }}>
        <Header isLoading={isLoading} />
        <main className="max-w-6xl mx-auto px-6 py-6">
          <Outlet />
        </main>
      </div>
    </RootDocument>
  );
}

function Header({ isLoading }: { isLoading: boolean }) {
  const location = useLocation();
  const currentPath = location.pathname;

  const navItems = [
    { path: "/", label: "Dashboard", icon: LayoutDashboard },
    { path: "/articles", label: "Articles", icon: FileText },
    { path: "/authors", label: "Authors", icon: Users },
    { path: "/analytics", label: "Analytics", icon: BarChart3 },
    { path: "/utilities", label: "Utilities", icon: Wrench },
    { path: "/settings", label: "Settings", icon: Settings },
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
                  path === "/"
                    ? currentPath === "/"
                    : currentPath.startsWith(path);

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

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Loading indicator */}
            {isLoading && (
              <Loader2
                className="w-4 h-4 animate-spin"
                style={{ color: "var(--fg-muted)" }}
              />
            )}
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

      {/* Loading bar */}
      {isLoading && (
        <div
          className="absolute bottom-0 left-0 h-0.5 animate-pulse"
          style={{
            background: "var(--accent)",
            width: "100%",
            animation: "loading-bar 1s ease-in-out infinite",
          }}
        />
      )}
    </header>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Meta />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* Prevent FOUC - set background immediately */
              html, body {
                background: #f8fafc;
              }

              /* Loading bar animation */
              @keyframes loading-bar {
                0% { transform: translateX(-100%); }
                50% { transform: translateX(0%); }
                100% { transform: translateX(100%); }
              }

              /* View transition for smoother navigation */
              ::view-transition-old(root),
              ::view-transition-new(root) {
                animation-duration: 150ms;
              }
            `,
          }}
        />
      </head>
      <body style={{ background: "var(--bg-root, #f8fafc)" }}>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
