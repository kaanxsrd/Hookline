import "server-only";
import { router } from "../trpc/init";
import { auditRouter } from "./audit";
import { endpointRouter } from "./endpoint";
import { memberRouter } from "./member";
import { orgRouter } from "./org";
import { requestRouter } from "./request";
import { streamRouter } from "./stream";

export const appRouter = router({
  audit: auditRouter,
  endpoint: endpointRouter,
  member: memberRouter,
  org: orgRouter,
  request: requestRouter,
  stream: streamRouter,
});

export type AppRouter = typeof appRouter;
