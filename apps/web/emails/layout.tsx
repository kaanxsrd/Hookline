import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

const colors = {
  page: "#f4f4f5",
  card: "#ffffff",
  text: "#18181b",
  muted: "#52525b",
  accent: "#4f46e5",
  border: "#e4e4e7",
};

export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: colors.page,
          color: colors.text,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          margin: 0,
          padding: "32px 0",
        }}
      >
        <Container
          style={{
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            maxWidth: 520,
            padding: "32px",
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: 600, margin: "0 0 24px" }}>Hookline</Text>
          {children}
          <Hr style={{ borderColor: colors.border, margin: "32px 0 16px" }} />
          <Text style={{ color: colors.muted, fontSize: 12, margin: 0 }}>
            Hookline: catch every webhook, replay anything, pipe it to localhost.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 14, lineHeight: "22px", margin: "0 0 16px" }}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return (
    <Text style={{ color: colors.muted, fontSize: 13, lineHeight: "20px", margin: "0 0 12px" }}>
      {children}
    </Text>
  );
}

export function ActionButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "8px 0 24px" }}>
      <Button
        href={href}
        style={{
          backgroundColor: colors.accent,
          borderRadius: 6,
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 600,
          padding: "10px 18px",
          textDecoration: "none",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

/** The raw link, for clients that block buttons. */
export function FallbackLink({ href }: { href: string }) {
  return (
    <Muted>
      Or paste this link into your browser:
      <br />
      <span style={{ wordBreak: "break-all" }}>{href}</span>
    </Muted>
  );
}
