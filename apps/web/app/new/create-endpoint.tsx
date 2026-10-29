"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { type CreateState, createTemporaryEndpoint } from "./actions";

/**
 * Submits the create action once on mount, so visiting /new in a browser
 * immediately creates an endpoint, while crawlers and link prefetchers (which
 * do not run scripts) never do. Without JavaScript the button does the same.
 */
export function CreateEndpoint() {
  const [state, action, pending] = useActionState<CreateState>(createTemporaryEndpoint, null);
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    form.current?.requestSubmit();
  }, []);

  return (
    <form ref={form} action={action} className="flex flex-col items-start gap-4">
      {state?.error ? (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      ) : (
        <p className="text-muted-foreground flex items-center gap-2" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Creating your endpoint…
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {state?.error ? "Try again" : "Create endpoint"}
      </button>
    </form>
  );
}
