const methodColors: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  POST: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  PUT: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  PATCH: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  DELETE: "bg-red-500/15 text-red-700 dark:text-red-300",
};

export function MethodChip({ method }: { method: string }) {
  return (
    <span
      className={`inline-flex w-16 shrink-0 justify-center rounded px-1.5 py-0.5 font-mono text-xs font-medium ${
        methodColors[method] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {method}
    </span>
  );
}
