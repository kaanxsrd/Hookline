"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="relative w-full max-w-sm">
      <Search
        className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        type="search"
        className="pl-8"
        placeholder={label}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * Runs an admin mutation with a toast for the outcome and refreshes the
 * server-rendered page on success.
 */
export function useAdminAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setPending(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
      return false;
    } finally {
      setPending(false);
    }
  }
  return { run, pending };
}

export function UserStateBadges({
  isAdmin,
  disabledAt,
  emailVerified,
}: {
  isAdmin: boolean;
  disabledAt: Date | null;
  emailVerified?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {isAdmin && <Badge variant="secondary">Admin</Badge>}
      {disabledAt && (
        <Badge variant="outline" className="text-destructive">
          Disabled
        </Badge>
      )}
      {emailVerified === false && <Badge variant="outline">Unverified</Badge>}
    </span>
  );
}
