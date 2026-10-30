import Link from "next/link";
import { GithubIcon } from "@/components/icons/github";
import { Logo } from "@/components/logo";
import { FOOTER_LINKS, REPOSITORY_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t">
      <div
        aria-hidden
        className="via-primary/60 absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
      />
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pt-14 pb-10 sm:px-6 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="text-muted-foreground space-y-4 text-sm">
          <Logo className="text-foreground" />
          <p className="max-w-xs leading-relaxed">
            Catch every webhook. Replay anything. Pipe it to localhost. Free software under the GNU
            General Public License v3.0.
          </p>
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground inline-flex items-center gap-2 transition-colors"
          >
            <GithubIcon className="size-4" /> Source on GitHub
          </a>
        </div>
        {FOOTER_LINKS.map((column) => (
          <div key={column.title}>
            <h2 className="font-mono text-xs tracking-widest uppercase">{column.title}</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
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
      <p
        aria-hidden
        className="from-foreground/10 pointer-events-none -mb-[0.22em] bg-gradient-to-b to-transparent bg-clip-text text-center text-[clamp(4rem,18vw,15rem)] leading-none font-bold tracking-tighter text-transparent select-none"
      >
        HOOKLINE
      </p>
    </footer>
  );
}
