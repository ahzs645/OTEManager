/// <reference types="vinxi/types/client" />
import { Buffer } from "buffer";

// Polyfill Buffer for client-side (needed by some Node.js libraries)
if (typeof window !== "undefined") {
  (window as any).Buffer = Buffer;
  (globalThis as any).Buffer = Buffer;
}

import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/start";
import { createRouter } from "./router";

const router = createRouter();

hydrateRoot(document, <StartClient router={router} />);
