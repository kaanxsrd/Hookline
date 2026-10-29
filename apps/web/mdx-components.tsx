import type { MDXComponents } from "mdx/types";
import type { Route } from "next";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A heading with a link to itself (ids come from rehype-slug). */
function heading(Tag: "h2" | "h3", className: string) {
  return function Heading({ id, children }: { id?: string; children?: ReactNode }) {
    return (
      <Tag id={id} className={cn("group scroll-mt-20 font-semibold tracking-tight", className)}>
        {children}
        {id && (
          <a
            href={`#${id}`}
            className="text-muted-foreground ml-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="Link to this section"
          >
            #
          </a>
        )}
      </Tag>
    );
  };
}

function Anchor({ href = "", children, ...rest }: ComponentProps<"a">) {
  const className = "text-primary underline-offset-4 hover:underline";
  // API routes are not pages: a plain link avoids a client-side navigation attempt.
  if (href.startsWith("/") && !href.startsWith("/api/")) {
    return (
      <Link href={href as Route} className={className}>
        {children}
      </Link>
    );
  }
  if (href.startsWith("#")) {
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} className={className} target="_blank" rel="noreferrer" {...rest}>
      {children}
    </a>
  );
}

/** A highlighted note inside docs: <Callout>…</Callout> or <Callout kind="warning">. */
export function Callout({
  kind = "note",
  children,
}: {
  kind?: "note" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      role="note"
      className={cn(
        "my-6 rounded-lg border px-4 py-3 text-sm [&>p]:my-0",
        kind === "warning"
          ? "border-amber-500/40 bg-amber-500/10"
          : "border-primary/30 bg-primary/5",
      )}
    >
      {children}
    </div>
  );
}

const components: MDXComponents = {
  h1: ({ children }) => (
    <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{children}</h1>
  ),
  h2: heading("h2", "mt-12 mb-4 border-b pb-2 text-2xl"),
  h3: heading("h3", "mt-8 mb-3 text-lg"),
  p: ({ children }) => <p className="my-4 leading-7">{children}</p>,
  a: Anchor,
  ul: ({ children }) => <ul className="my-4 list-disc space-y-2 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 list-decimal space-y-2 pl-6">{children}</ol>,
  li: ({ children }) => <li className="leading-7 [&>p]:my-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="text-muted-foreground my-6 border-l-2 pl-4">{children}</blockquote>
  ),
  hr: () => <hr className="my-10" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  pre: ({ children }) => (
    <pre className="bg-card my-6 overflow-x-auto rounded-lg border p-4 font-mono text-sm leading-6 [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.875em]">{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-6 w-full overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50 text-left">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="border-t px-3 py-2 align-top">{children}</td>,
  Callout,
};

export function useMDXComponents(): MDXComponents {
  return components;
}
