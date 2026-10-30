"use client";

// The marketing and docs navbar, after Aceternity UI's Resizable Navbar
// (https://ui.aceternity.com/components/resizable-navbar): full width at the
// top of the page, a floating glass pill once the page scrolls.
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { MARKETING_NAV } from "@/lib/site";
import { cn } from "@/lib/utils";

export function SiteNavbar({ signedIn, sticky = true }: { signedIn: boolean; sticky?: boolean }) {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useMotionValueEvent(scrollY, "change", (y) => setScrolled(sticky && y > 40));

  return (
    <header className={cn("z-50 w-full", sticky && "sticky top-0")}>
      <motion.div
        animate={{
          maxWidth: scrolled ? 860 : 1152,
          y: scrolled ? 12 : 0,
          borderRadius: scrolled ? 9999 : 0,
        }}
        transition={{ type: "spring", stiffness: 220, damping: 30 }}
        className={cn(
          "mx-auto flex h-14 items-center gap-6 px-4 transition-[background-color,box-shadow,border-color] sm:px-6",
          scrolled
            ? "bg-background/70 supports-[backdrop-filter]:bg-background/50 border shadow-[0_8px_30px_rgb(0_0_0/0.12)] backdrop-blur-xl"
            : "border border-transparent",
        )}
      >
        <Link href="/" aria-label="Hookline home" className="shrink-0">
          <Logo />
        </Link>

        <nav
          aria-label="Site"
          className="hidden items-center sm:flex"
          onMouseLeave={() => setHovered(null)}
        >
          {MARKETING_NAV.map(({ href, label }) => {
            const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
            return (
              <Link
                key={href}
                href={href}
                onMouseEnter={() => setHovered(href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative px-3 py-1.5 text-sm transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {hovered === href && (
                  <motion.span
                    layoutId="nav-hover"
                    className="bg-accent absolute inset-0 rounded-full"
                    transition={{ type: "spring", stiffness: 400, damping: 35 }}
                  />
                )}
                <span className="relative">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {signedIn ? (
            <Link
              href="/dashboard"
              className="bg-primary text-primary-foreground rounded-full px-4 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="text-muted-foreground hover:text-foreground hidden px-3 py-1.5 text-sm transition-colors sm:inline-flex"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="bg-primary text-primary-foreground rounded-full px-4 py-1.5 text-sm font-medium shadow-[0_0_24px_-6px_var(--primary)] transition-opacity hover:opacity-90"
              >
                Sign up
              </Link>
            </>
          )}
          <button
            type="button"
            className="text-muted-foreground hover:bg-accent inline-flex size-9 items-center justify-center rounded-md sm:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Site"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-background/95 absolute inset-x-4 top-16 grid gap-1 rounded-2xl border p-3 shadow-xl backdrop-blur-xl sm:hidden"
          >
            {MARKETING_NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="hover:bg-accent rounded-lg px-3 py-2 text-sm"
              >
                {label}
              </Link>
            ))}
            {!signedIn && (
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className="hover:bg-accent rounded-lg px-3 py-2 text-sm"
              >
                Sign in
              </Link>
            )}
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
