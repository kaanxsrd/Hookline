import type { Metadata } from "next";
import { Suspense } from "react";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = {
  title: "Two-factor authentication",
  description: "Enter the code from your authenticator app to finish signing in.",
};

export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  );
}
