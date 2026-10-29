import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authorizeAnonymous, parseVisitorCookie, VISITOR_COOKIE } from "@/lib/anonymous";
import { CreateEndpoint } from "./create-endpoint";

export const metadata: Metadata = {
  title: "New temporary endpoint",
  description: "Get a URL that captures any HTTP request for 24 hours, no account needed.",
  robots: { index: false },
};

export default async function NewEndpointPage() {
  const visitor = parseVisitorCookie((await cookies()).get(VISITOR_COOKIE)?.value);
  if (visitor && (await authorizeAnonymous(visitor.slug, visitor.token))) {
    redirect(`/e/${visitor.slug}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold tracking-tight">A temporary webhook URL</h1>
      <p className="text-muted-foreground">
        No account needed. It captures any request for 24 hours, up to 100 requests.
      </p>
      <CreateEndpoint />
    </main>
  );
}
