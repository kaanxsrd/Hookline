"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      className="hover:bg-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
    >
      <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden />
      Refresh
    </button>
  );
}
