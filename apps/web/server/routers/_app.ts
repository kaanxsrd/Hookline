import "server-only";
import { router } from "../trpc/init";
import { auditRouter } from "./audit";
import { deliveryRouter } from "./delivery";
import { destinationRouter } from "./destination";
import { endpointRouter } from "./endpoint";
import { memberRouter } from "./member";
import { orgRouter } from "./org";
import { requestRouter } from "./request";
import { streamRouter } from "./stream";

export const appRouter = router({
  audit: auditRouter,
  delivery: deliveryRouter,
  destination: destinationRouter,
  endpoint: endpointRouter,
  member: memberRouter,
  org: orgRouter,
  request: requestRouter,
  stream: streamRouter,
});

export type AppRouter = typeof appRouter;
