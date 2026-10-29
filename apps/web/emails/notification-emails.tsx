import { ActionButton, EmailLayout, FallbackLink, Muted, Paragraph } from "./layout";

/**
 * Notification emails. The worker sends DeliveryFailing and UsageThreshold:
 * `bun run gen` renders them with Go template placeholders ("{{.OrgName}}")
 * into packages/gocommon/mail/templates, so props here are plain strings.
 */

export function DeliveryFailing({
  orgName,
  destinationName,
  destinationUrl,
  endpointName,
  lastResult,
  url,
}: {
  orgName: string;
  destinationName: string;
  destinationUrl: string;
  endpointName: string;
  lastResult: string;
  url: string;
}) {
  return (
    <EmailLayout preview={`Deliveries to ${destinationName} are failing`}>
      <Paragraph>
        Hookline gave up delivering a request from <strong>{endpointName}</strong> to{" "}
        <strong>{destinationName}</strong> ({destinationUrl}) in {orgName} after every retry.
      </Paragraph>
      <Paragraph>Last result: {lastResult}</Paragraph>
      <ActionButton href={url}>Review failed deliveries</ActionButton>
      <FallbackLink href={url} />
      <Muted>
        You can retry them once the destination is back. We send at most one of these an hour per
        destination.
      </Muted>
    </EmailLayout>
  );
}

export function UsageThreshold({
  orgName,
  percent,
  used,
  limit,
  plan,
  url,
}: {
  orgName: string;
  percent: string;
  used: string;
  limit: string;
  plan: string;
  url: string;
}) {
  return (
    <EmailLayout preview={`${orgName} has used ${percent}% of this month's requests`}>
      <Paragraph>
        {orgName} has used {percent}% of the {limit} requests its {plan} plan includes this month (
        {used} so far).
      </Paragraph>
      <Paragraph>
        Once the limit is reached, endpoints answer 429 until the month ends. Upgrade to keep
        capturing.
      </Paragraph>
      <ActionButton href={url}>See usage</ActionButton>
      <FallbackLink href={url} />
    </EmailLayout>
  );
}

export function PlanChanged({
  orgName,
  plan,
  url,
}: {
  orgName: string;
  plan: string;
  url: string;
}) {
  return (
    <EmailLayout preview={`${orgName} is now on the ${plan} plan`}>
      <Paragraph>
        {orgName} is now on the <strong>{plan}</strong> plan. The new limits apply right away.
      </Paragraph>
      <ActionButton href={url}>Open billing</ActionButton>
      <FallbackLink href={url} />
      <Muted>You receive this because you are an owner or admin of {orgName}.</Muted>
    </EmailLayout>
  );
}
