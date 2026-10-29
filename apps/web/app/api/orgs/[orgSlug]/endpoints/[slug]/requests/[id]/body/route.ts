import { TRPCError } from "@trpc/server";
import { bodyDownload } from "@/lib/body-download";
import { appRouter } from "@/server/routers/_app";
import { orgEndpoint } from "@/server/routers/request";
import { createContext } from "@/server/trpc/context";
import { createCallerFactory } from "@/server/trpc/init";

const createCaller = createCallerFactory(appRouter);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/orgs/{org}/endpoints/{slug}/requests/{id}/body — the raw captured body. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; slug: string; id: string }> },
) {
  const { orgSlug, slug, id } = await params;
  if (!UUID.test(id))
    return Response.json(
      { error: { code: "not_found", message: "Request not found." } },
      { status: 404 },
    );
  const ctx = await createContext(request.headers);
  try {
    // Membership check through the same procedure the dashboard uses.
    const org = await createCaller(ctx).org.current({ orgSlug });
    const endpoint = await orgEndpoint({ db: ctx.db, org }, slug);
    return await bodyDownload(ctx.db, endpoint, id);
  } catch (error) {
    if (error instanceof TRPCError) {
      const status = error.code === "UNAUTHORIZED" ? 401 : 404;
      return Response.json(
        { error: { code: error.code.toLowerCase(), message: error.message } },
        { status },
      );
    }
    throw error;
  }
}
