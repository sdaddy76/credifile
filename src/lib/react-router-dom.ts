// This facade preserves every original export while overriding only the
// messaging-aware components. Components and non-component exports live
// in separate modules so the component module is a Fast Refresh boundary.
// @ts-expect-error - This is resolved at runtime by Vite alias.
export * from "react-router-dom-original";
export {
  Routes,
  HashRouter,
  BrowserRouter,
  MemoryRouter,
} from "./react-router-dom-proxy";
