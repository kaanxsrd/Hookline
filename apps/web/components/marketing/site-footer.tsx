import Link from "next/link";
import { Logo } from "@/components/logo";
import { FOOTER_LINKS, REPOSITORY_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="text-muted-foreground space-y-3 text-sm">
          <Logo className="text-foreground" />
          <p className="max-w-xs">
            Catch every webhook. Replay anything. Pipe it to localhost. Open source under the MIT
            license.
          </p>
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground inline-block underline-offset-4 hover:underline"
          >
            Source on GitHub
          </a>
        </div>
        {FOOTER_LINKS.map((column) => (
          <div key={column.title}>
            <h2 className="text-sm font-medium">{column.title}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {column.links.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}
