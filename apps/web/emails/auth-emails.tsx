import { ActionButton, EmailLayout, FallbackLink, Muted, Paragraph } from "./layout";

export function VerifyEmail({ name, url }: { name: string; url: string }) {
  return (
    <EmailLayout preview="Confirm your email address for Hookline">
      <Paragraph>Hi {name},</Paragraph>
      <Paragraph>Confirm your email address to finish creating your Hookline account.</Paragraph>
      <ActionButton href={url}>Verify email</ActionButton>
      <FallbackLink href={url} />
      <Muted>The link expires in 24 hours. If you did not sign up, ignore this email.</Muted>
    </EmailLayout>
  );
}

export function ResetPassword({ name, url }: { name: string; url: string }) {
  return (
    <EmailLayout preview="Reset your Hookline password">
      <Paragraph>Hi {name},</Paragraph>
      <Paragraph>Someone asked to reset the password for your Hookline account.</Paragraph>
      <ActionButton href={url}>Choose a new password</ActionButton>
      <FallbackLink href={url} />
      <Muted>
        The link expires in one hour and signs out your other sessions. If this was not you, ignore
        this email; your password stays the same.
      </Muted>
    </EmailLayout>
  );
}

export function Invitation({
  inviter,
  organization,
  role,
  url,
}: {
  inviter: string;
  organization: string;
  role: string;
  url: string;
}) {
  return (
    <EmailLayout preview={`${inviter} invited you to ${organization} on Hookline`}>
      <Paragraph>
        {inviter} invited you to join <strong>{organization}</strong> on Hookline as{" "}
        {role === "admin" ? "an" : "a"} {role}.
      </Paragraph>
      <ActionButton href={url}>Accept invitation</ActionButton>
      <FallbackLink href={url} />
      <Muted>
        The invitation expires in 48 hours. If you were not expecting it, ignore this email.
      </Muted>
    </EmailLayout>
  );
}

export function ChangeEmail({
  name,
  newEmail,
  url,
}: {
  name: string;
  newEmail: string;
  url: string;
}) {
  return (
    <EmailLayout preview="Approve the change of your Hookline email address">
      <Paragraph>Hi {name},</Paragraph>
      <Paragraph>
        Someone asked to change the email address of your Hookline account to{" "}
        <strong>{newEmail}</strong>. Approve it to continue; we will then ask the new address to
        confirm.
      </Paragraph>
      <ActionButton href={url}>Approve the change</ActionButton>
      <FallbackLink href={url} />
      <Muted>If this was not you, ignore this email and change your password.</Muted>
    </EmailLayout>
  );
}
