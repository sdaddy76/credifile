import * as React from "react";

// Runtime import of the real library under a different name (see vite.config alias)
// @ts-expect-error - This is resolved at runtime by Vite alias
import * as OriginalRRD from "react-router-dom-original";
import {
  emitRouteChange,
  isIframeCmd,
  postAllRoutesOnce,
  routesReadyOrTimeout,
} from "./route-messaging";

const RRD = OriginalRRD as typeof import("react-router-dom");

/** Our patched <Routes/>: same API, just posts route list once. */
export function Routes(props: React.ComponentProps<typeof RRD.Routes>) {
  React.useEffect(() => {
    postAllRoutesOnce(props.children, RRD.Route);
  }, [props.children]);
  return React.createElement(RRD.Routes, { ...props });
}

/** A component that lives inside the router context and bridges both ways */
function RouterBridge(): null {
  const location = RRD.useLocation();
  const navigate = RRD.useNavigate();

  React.useEffect(() => {
    (async () => {
      // Ensure ROUTES_INFO is delivered first
      await routesReadyOrTimeout();   // waits for <Routes/> to post, or times out (dev-safety)
      emitRouteChange(location);
    })();
  }, [location]);

  React.useEffect(() => {
    function onMessage(e: MessageEvent<unknown>) {
      const data = e.data;
      if (!isIframeCmd(data)) return;
      
      // Check if route messaging is enabled
      if (!__ROUTE_MESSAGING_ENABLED__) {
        return;
      }

      try {
        if (data.type === "ROUTE_CONTROL") {
          const { action } = data;
          
          console.log('Received route control command:', data);

          switch (action) {
            case 'navigate':
              if (data.path) {
                const replace = data.replace ?? false;
                navigate(data.path, { replace });
                console.log(`Navigated to: ${data.path} (replace: ${replace})`);
              } else {
                console.error('Route control: path is required for navigate action');
              }
              break;
              
            case 'back':
              navigate(-1);
              console.log('Navigated back');
              break;
              
            case 'forward':
              navigate(1);
              console.log('Navigated forward');
              break;
              
            case 'replace':
              if (data.path) {
                navigate(data.path, { replace: true });
                console.log(`Replaced route with: ${data.path}`);
              } else {
                console.error('Route control: path is required for replace action');
              }
              break;
              
            default:
              console.warn('Route control: unknown action', action);
          }
        } else if (data.type === "RELOAD") {
          window.location.reload();
          console.log('Reloaded');
        }
      } catch (error) {
        console.error('Route control error:', error);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);

  return null;
}

/** Wrap routers so the bridge lives inside router context, with zero app changes. */
// Make children mount before <RouterBridge/>, so <Routes/> effect runs first.
function withBridge(children: React.ReactNode) {
  return (
    <>
      {children}
      <RouterBridge />
    </>
  );
}

export function HashRouter(props: React.ComponentProps<typeof RRD.HashRouter>) {
  return <RRD.HashRouter {...props}>{withBridge(props.children)}</RRD.HashRouter>;
}

export function BrowserRouter(props: React.ComponentProps<typeof RRD.BrowserRouter>) {
  return <RRD.BrowserRouter {...props}>{withBridge(props.children)}</RRD.BrowserRouter>;
}

export function MemoryRouter(props: React.ComponentProps<typeof RRD.MemoryRouter>) {
  return <RRD.MemoryRouter {...props}>{withBridge(props.children)}</RRD.MemoryRouter>;
}
