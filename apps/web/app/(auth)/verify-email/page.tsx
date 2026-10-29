import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailNotice } from "./verify-email-notice";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Confirm your email address to start using Hookline.",
};

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailNotice />
    </Suspense>
  );
}
