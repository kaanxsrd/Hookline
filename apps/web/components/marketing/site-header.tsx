import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/session";
import { MARKETING_NAV } from "@/lib/site";
import { cn } from "@/lib/utils";
import { MobileNav } from "./mobile-nav";

/** Header of the marketing site and docs. Signed-in visitors get a way back to the app. */
export async function SiteHeader({ sticky = true }: { sticky?: boolean }) {
  const session = await getSession();
  const signedIn = Boolean(session?.user.emailVerified);

  return (
    <header
      className={cn(
        "bg-background/80 supports-[backdrop-filter]:bg-background/60 z-40 border-b backdrop-blur",
        sticky && "sticky top-0",
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Hookline home">
          <Logo />
        </Link>
        <nav aria-label="Site" className="hidden items-center gap-1 sm:flex">
          {MARKETING_NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm transition-colors"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/sign-up">Sign up</Link>
              </Button>
            </>
          )}
          <MobileNav signedIn={signedIn} />
        </div>
      </div>
    </header>
  );
}
