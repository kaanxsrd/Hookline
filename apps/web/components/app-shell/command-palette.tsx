"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, LayoutDashboard, Moon, Plus, Settings, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useTRPC } from "@/lib/trpc/client";
import type { ShellOrg } from "./app-shell";

/** Opens on ⌘K / Ctrl+K anywhere in the app. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({
  org,
  open,
  onOpenChange,
}: {
  org: ShellOrg;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const trpc = useTRPC();
  const { resolvedTheme, setTheme } = useTheme();
  const endpoints = useQuery({
    ...trpc.endpoint.list.queryOptions({ orgSlug: org.slug }),
    enabled: open,
  });

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  const base = `/${org.slug}`;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Jump anywhere"
    >
      <CommandInput placeholder="Type a command or search endpoints…" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        {endpoints.data && endpoints.data.length > 0 && (
          <CommandGroup heading="Endpoints">
            {endpoints.data.map((e) => (
              <CommandItem
                key={e.id}
                value={`open ${e.name} ${e.slug}`}
                onSelect={() => run(() => router.push(`${base}/endpoints/${e.slug}`))}
              >
                <Webhook aria-hidden /> {e.name}
              </CommandItem>
            ))}
            {endpoints.data.map((e) => (
              <CommandItem
                key={`copy-${e.id}`}
                value={`copy url ${e.name} ${e.slug}`}
                onSelect={() =>
                  run(async () => {
                    await navigator.clipboard.writeText(e.url);
                    toast.success(`Copied the URL of ${e.name}`);
                  })
                }
              >
                <Copy aria-hidden /> Copy URL of {e.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => router.push(`${base}/endpoints/new`))}>
            <Plus aria-hidden /> Create endpoint
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => setTheme(resolvedTheme === "light" ? "dark" : "light"))}
          >
            <Moon aria-hidden /> Toggle theme
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => run(() => router.push(base))}>
            <LayoutDashboard aria-hidden /> Overview
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push(`${base}/endpoints`))}>
            <Webhook aria-hidden /> Endpoints
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push(`${base}/settings/general`))}>
            <Settings aria-hidden /> Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
