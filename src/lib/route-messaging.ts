import * as React from "react";
import type { Location } from "react-router-dom";

type RouteNodeProps = {
  path?: string;
  index?: boolean;
  children?: React.ReactNode;
};

export type IframeCmd =
  | { type: "ROUTE_CONTROL"; action: "navigate"; path: string; replace?: boolean }
  | { type: "ROUTE_CONTROL"; action: "back" | "forward" }
  | { type: "ROUTE_CONTROL"; action: "replace"; path: string }
  | { type: "RELOAD" };

export function isIframeCmd(value: unknown): value is IframeCmd {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  if (value.type === "RELOAD") return true;
  if (value.type !== "ROUTE_CONTROL" || !("action" in value)) return false;
  if (value.action === "back" || value.action === "forward") return true;
  if (value.action !== "navigate" && value.action !== "replace") return false;
  return "path" in value && typeof value.path === "string" &&
    (!("replace" in value) || value.replace === undefined || typeof value.replace === "boolean");
}

let routesPosted = false;
let lastEmittedPath = "";
let resolveRoutesReady: (() => void) | null = null;
const routesReadyPromise = new Promise<void>((resolve) => {
  resolveRoutesReady = resolve;
});

export const routesReadyOrTimeout = (ms = 1200) =>
  Promise.race([
    routesReadyPromise,
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);

function join(base: string, child?: string) {
  if (!child) return base || "";
  if (child.startsWith("/")) return child;
  return `${base.replace(/\/$/, "")}/${child}`.replace(/\/+/g, "/");
}

function flattenRoutes(
  node: React.ReactNode,
  routeComponent: React.ElementType,
  base = "",
  acc = new Set<string>(),
) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement<RouteNodeProps>(child)) return;
    const isRoute = child.type === routeComponent ||
      (typeof child.type === "function" && child.type.name === "Route");
    const { path, index, children } = child.props;
    if (isRoute) {
      const current = index ? (base || "/") : (path ? join(base, path) : base);
      if (index || path) acc.add(current || "/");
      if (children) flattenRoutes(children, routeComponent, current, acc);
    } else if (children) {
      flattenRoutes(children, routeComponent, base, acc);
    }
  });
  return acc;
}

export function postAllRoutesOnce(
  children: React.ReactNode,
  routeComponent: React.ElementType,
) {
  if (routesPosted) return;
  try {
    const list = Array.from(flattenRoutes(children, routeComponent)).sort();
    if (process.env.NODE_ENV === "development") {
      console.log("Routes:", list);
    }
    if (!__ROUTE_MESSAGING_ENABLED__) return;
    if (window.top && window.top !== window) {
      window.top.postMessage({
        type: "ROUTES_INFO",
        routes: list.map((path) => ({ path })),
        timestamp: Date.now(),
      }, "*");
    }
  } finally {
    routesPosted = true;
    resolveRoutesReady?.();
    resolveRoutesReady = null;
  }
}

export function emitRouteChange(location: Location) {
  const path = `${location.pathname}${location.search}${location.hash}`;
  if (path === lastEmittedPath) return;
  lastEmittedPath = path;
  if (!__ROUTE_MESSAGING_ENABLED__) return;
  if (window.top && window.top !== window) {
    window.top.postMessage({
      type: "ROUTE_CHANGE",
      path: location.pathname,
      hash: location.hash,
      search: location.search,
      fullPath: path,
      fullUrl: window.location.href,
      timestamp: Date.now(),
    }, "*");
  }
}
