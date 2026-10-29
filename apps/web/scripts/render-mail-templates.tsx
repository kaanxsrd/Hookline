/**
 * Renders the worker's notification emails (emails/notification-emails.tsx)
 * into Go html/template and text/template files with {{.Field}} placeholders.
 * Run by `bun run gen`; the output is committed and checked for drift.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { DeliveryFailing, UsageThreshold } from "../emails/notification-emails";

const out = join(__dirname, "../../../packages/gocommon/mail/templates");

/** A placeholder Go fills in; html/template escapes the value for its context. */
const field = (name: string) => `{{.${name}}}`;

const templates: Record<string, ReactElement> = {
  delivery_failing: (
    <DeliveryFailing
      orgName={field("OrgName")}
      destinationName={field("DestinationName")}
      destinationUrl={field("DestinationURL")}
      endpointName={field("EndpointName")}
      lastResult={field("LastResult")}
      url={field("URL")}
    />
  ),
  usage_threshold: (
    <UsageThreshold
      orgName={field("OrgName")}
      percent={field("Percent")}
      used={field("Used")}
      limit={field("Limit")}
      plan={field("Plan")}
      url={field("URL")}
    />
  ),
};

mkdirSync(out, { recursive: true });
for (const [name, element] of Object.entries(templates)) {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  const header = "{{/* Code generated from apps/web/emails by `bun run gen`. DO NOT EDIT. */}}";
  writeFileSync(join(out, `${name}.html`), `${header}${html}\n`);
  writeFileSync(join(out, `${name}.txt`), `${header}${text}\n`);
}
console.log(
  `mail templates: wrote ${Object.keys(templates).length} to packages/gocommon/mail/templates`,
);
