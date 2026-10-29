"use client";

import { KeyRound, Laptop, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Field, FormMessage, SubmitButton } from "@/components/auth/form-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { authClient, authErrorMessage } from "@/lib/auth-client";

type Props = {
  user: { name: string; email: string; twoFactorEnabled: boolean };
  currentSessionToken: string;
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 border-b pb-10 last:border-b-0">
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function AccountSettings({ user, currentSessionToken }: Props) {
  return (
    <div className="grid max-w-2xl gap-10">
      <Profile user={user} />
      <Password />
      <Passkeys />
      <TwoFactor enabled={user.twoFactorEnabled} />
      <Sessions currentToken={currentSessionToken} />
      <DeleteAccount />
    </div>
  );
}

function Profile({ user }: { user: Props["user"] }) {
  const router = useRouter();
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const [pending, setPending] = useState(false);

  return (
    <Section title="Profile" description="Your name is shown to members of your organizations.">
      <form
        className="grid gap-4"
        action={async (form) => {
          setPending(true);
          const name = String(form.get("name"));
          const email = String(form.get("email")).trim().toLowerCase();
          const results = [await authClient.updateUser({ name })];
          if (email !== user.email) {
            results.push(
              await authClient.changeEmail({ newEmail: email, callbackURL: "/account" }),
            );
          }
          setPending(false);
          const failed = results.find((r) => r.error);
          if (failed?.error) setState({ error: authErrorMessage(failed.error) });
          else {
            setState({
              success:
                email !== user.email
                  ? `Saved. Approve the change from ${user.email}, then confirm it from ${email}.`
                  : "Saved.",
            });
            router.refresh();
          }
        }}
      >
        <Field label="Name" id="name" defaultValue={user.name} required maxLength={100} />
        <Field label="Email" id="email" type="email" defaultValue={user.email} required />
        <FormMessage error={state.error ?? null} success={state.success ?? null} />
        <SubmitButton pending={pending} className="justify-self-start">
          Save profile
        </SubmitButton>
      </form>
    </Section>
  );
}

function Password() {
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const [pending, setPending] = useState(false);
  return (
    <Section title="Password" description="Changing it signs you out on every other device.">
      <form
        className="grid gap-4"
        action={async (form) => {
          setPending(true);
          const { error } = await authClient.changePassword({
            currentPassword: String(form.get("current")),
            newPassword: String(form.get("new")),
            revokeOtherSessions: true,
          });
          setPending(false);
          setState(error ? { error: authErrorMessage(error) } : { success: "Password changed." });
        }}
      >
        <Field
          label="Current password"
          id="current"
          type="password"
          autoComplete="current-password"
          required
        />
        <Field
          label="New password"
          id="new"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          hint="At least 10 characters."
        />
        <FormMessage error={state.error ?? null} success={state.success ?? null} />
        <SubmitButton pending={pending} className="justify-self-start">
          Change password
        </SubmitButton>
      </form>
    </Section>
  );
}

function Passkeys() {
  const passkeys = authClient.useListPasskeys();
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const result = await authClient.passkey.addPasskey({ name: navigator.platform || "Passkey" });
    if (result?.error) setError(authErrorMessage(result.error));
    else {
      toast.success("Passkey added");
      passkeys.refetch();
    }
  }

  async function remove(id: string) {
    const { error } = await authClient.passkey.deletePasskey({ id });
    if (error) toast.error(authErrorMessage(error));
    else passkeys.refetch();
  }

  return (
    <Section
      title="Passkeys"
      description="Sign in with your fingerprint, face or a security key instead of a password."
    >
      {passkeys.data && passkeys.data.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {passkeys.data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <KeyRound className="text-muted-foreground size-4" aria-hidden />
              <span className="flex-1">{p.name ?? "Passkey"}</span>
              <span className="text-muted-foreground text-xs">
                Added {new Date(p.createdAt).toLocaleDateString()}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${p.name ?? "passkey"}`}
                onClick={() => remove(p.id)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FormMessage error={error} />
      <Button variant="outline" className="justify-self-start" onClick={add}>
        <KeyRound aria-hidden /> Add a passkey
      </Button>
    </Section>
  );
}

function TwoFactor({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ qr: string; secret: string; backupCodes: string[] } | null>(
    null,
  );
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(form: FormData) {
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({
      password: String(form.get("password")),
    });
    setPending(false);
    if (error || !data || data.method !== "totp") {
      setError(authErrorMessage(error));
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSetup({
      qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 192 }),
      secret,
      backupCodes: data.backupCodes,
    });
  }

  async function confirm(form: FormData) {
    setPending(true);
    const { error } = await authClient.twoFactor.verifyTotp({
      code: String(form.get("code")).replace(/\s+/g, ""),
    });
    setPending(false);
    if (error) {
      setError(authErrorMessage(error));
      return;
    }
    setCodes(setup?.backupCodes ?? null);
    setSetup(null);
    toast.success("Two-factor authentication is on");
    router.refresh();
  }

  async function disable(form: FormData) {
    setPending(true);
    const { error } = await authClient.twoFactor.disable({
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) setError(authErrorMessage(error));
    else {
      toast.success("Two-factor authentication is off");
      router.refresh();
    }
  }

  async function regenerate(form: FormData) {
    setPending(true);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({
      password: String(form.get("password")),
    });
    setPending(false);
    if (error || !data) setError(authErrorMessage(error));
    else setCodes(data.backupCodes);
  }

  return (
    <Section
      title="Two-factor authentication"
      description="Ask for a code from an authenticator app when you sign in with a password."
    >
      <div>
        {enabled ? (
          <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-300">
            <ShieldCheck aria-hidden /> On
          </Badge>
        ) : (
          <Badge variant="outline">Off</Badge>
        )}
      </div>

      {codes && (
        <div className="bg-card grid gap-2 rounded-lg border p-4">
          <p className="text-sm font-medium">Backup codes</p>
          <p className="text-muted-foreground text-xs">
            Store these somewhere safe. Each works once if you lose your authenticator. They are not
            shown again.
          </p>
          <pre data-testid="backup-codes" className="grid grid-cols-2 gap-1 font-mono text-sm">
            {codes.join("\n")}
          </pre>
        </div>
      )}

      {setup ? (
        <form action={confirm} className="grid gap-4">
          {/* biome-ignore lint/performance/noImgElement: a data: URL QR code, nothing to optimize */}
          <img
            src={setup.qr}
            alt="QR code for your authenticator app"
            className="size-48 rounded bg-white p-2"
          />
          <p className="text-muted-foreground text-sm">
            Scan it with your authenticator app, or enter this key:{" "}
            <code data-testid="totp-secret" className="text-foreground font-mono">
              {setup.secret}
            </code>
          </p>
          <Field
            label="Code from the app"
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
          <FormMessage error={error} />
          <SubmitButton pending={pending} className="justify-self-start">
            Turn on
          </SubmitButton>
        </form>
      ) : enabled ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <form action={regenerate} className="grid gap-2">
            <Field label="Password" id="regen-password" name="password" type="password" required />
            <SubmitButton pending={pending} variant="outline">
              New backup codes
            </SubmitButton>
          </form>
          <form action={disable} className="grid gap-2">
            <Field
              label="Password"
              id="disable-password"
              name="password"
              type="password"
              required
            />
            <SubmitButton pending={pending} variant="outline">
              Turn off
            </SubmitButton>
          </form>
          <FormMessage error={error} />
        </div>
      ) : (
        <form action={start} className="grid gap-4">
          <Field
            label="Password"
            id="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <FormMessage error={error} />
          <SubmitButton pending={pending} className="justify-self-start">
            Set up two-factor authentication
          </SubmitButton>
        </form>
      )}
    </Section>
  );
}

type SessionRow = {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: Date;
};

function Sessions({ currentToken }: { currentToken: string }) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await authClient.listSessions();
    setSessions((data as SessionRow[] | null) ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Section title="Sessions" description="Devices signed in to your account.">
      <ul className="divide-y rounded-lg border">
        {(sessions ?? []).map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <Laptop className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{s.userAgent ?? "Unknown device"}</span>
              <span className="text-muted-foreground text-xs">
                Since {new Date(s.createdAt).toLocaleString()}
              </span>
            </span>
            {s.token === currentToken ? (
              <Badge variant="secondary">This device</Badge>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await authClient.revokeSession({ token: s.token });
                  load();
                }}
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {sessions && sessions.length > 1 && (
        <Button
          variant="outline"
          className="justify-self-start"
          onClick={async () => {
            await authClient.revokeOtherSessions();
            toast.success("Signed out everywhere else");
            load();
          }}
        >
          Sign out of all other devices
        </Button>
      )}
    </Section>
  );
}

function DeleteAccount() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Section
      title="Delete account"
      description="Removes your account and every organization you are the only member of. This cannot be undone."
    >
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="destructive" className="justify-self-start">
            Delete account
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>Enter your password to confirm.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            action={async (form) => {
              setPending(true);
              const { error } = await authClient.deleteUser({
                password: String(form.get("password")),
              });
              setPending(false);
              if (error) setError(authErrorMessage(error));
              else window.location.href = "/";
            }}
          >
            <Field label="Password" id="delete-password" name="password" type="password" required />
            <FormMessage error={error} />
            <DialogFooter>
              <SubmitButton pending={pending} variant="destructive">
                Delete forever
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
