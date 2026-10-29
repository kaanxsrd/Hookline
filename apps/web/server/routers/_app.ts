import "server-only";
import { router } from "../trpc/init";
import { apiKeyRouter } from "./api-key";
import { auditRouter } from "./audit";
import { billingRouter } from "./billing";
import { cliRouter } from "./cli";
import { deliveryRouter } from "./delivery";
import { destinationRouter } from "./destination";
import { endpointRouter } from "./endpoint";
import { memberRouter } from "./member";
import { orgRouter } from "./org";
import { replayRouter } from "./replay";
import { requestRouter } from "./request";
import { streamRouter } from "./stream";
import { usageRouter } from "./usage";

export const appRouter = router({
  apiKey: apiKeyRouter,
  audit: auditRouter,
  billing: billingRouter,
  cli: cliRouter,
  delivery: deliveryRouter,
  destination: destinationRouter,
  endpoint: endpointRouter,
  member: memberRouter,
  org: orgRouter,
  replay: replayRouter,
  request: requestRouter,
  stream: streamRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
