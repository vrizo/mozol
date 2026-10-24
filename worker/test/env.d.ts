// Types for `env` and `exports` from "cloudflare:workers" in tests.
import type { Env as WorkerEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/index");
    }
    interface Env extends WorkerEnv {}
  }
}
