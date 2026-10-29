import "server-only";
import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { appRouter } from "@/server/routers/_app";
import { createContext } from "@/server/trpc/context";
import { createCallerFactory } from "@/server/trpc/init";

const createCaller = createCallerFactory(appRouter);

/** tRPC caller for Server Components, created once per request. */
export const api = cache(async () => createCaller(await createContext(await headers())));

/** Runs a server-side call, turning auth and lookup failures into the matching page outcome. */
export async function load<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TRPCError) {
      if (error.code === "UNAUTHORIZED") redirect("/sign-in");
      if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") notFound();
    }
    throw error;
  }
}
