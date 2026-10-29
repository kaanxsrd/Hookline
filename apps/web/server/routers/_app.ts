import "server-only";
import { router } from "../trpc/init";
import { auditRouter } from "./audit";
import { cliRouter } from "./cli";
import { deliveryRouter } from "./delivery";
import { destinationRouter } from "./destination";
import { endpointRouter } from "./endpoint";
import { memberRouter } from "./member";
import { orgRouter } from "./org";
import { replayRouter } from "./replay";
import { requestRouter } from "./request";
import { streamRouter } from "./stream";

export const appRouter = router({
  audit: auditRouter,
  cli: cliRouter,
  delivery: deliveryRouter,
  destination: destinationRouter,
  endpoint: endpointRouter,
  member: memberRouter,
  org: orgRouter,
  replay: replayRouter,
  request: requestRouter,
  stream: streamRouter,
});

export type AppRouter = typeof appRouter;
