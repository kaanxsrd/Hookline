import "server-only";
import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

let client: S3Client | undefined;

function s3(): S3Client {
  const e = env();
  client ??= new S3Client({
    region: e.S3_REGION,
    ...(e.S3_ENDPOINT ? { endpoint: e.S3_ENDPOINT } : {}),
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  });
  return client;
}

export function storageConfigured(): boolean {
  return env().S3_BUCKET !== "";
}

/** The first `maxBytes` of a stored body, or null when it is missing. */
export async function readBodyPrefix(key: string, maxBytes: number): Promise<Uint8Array | null> {
  try {
    const out = await s3().send(
      new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Range: `bytes=0-${maxBytes - 1}` }),
    );
    return out.Body ? await out.Body.transformToByteArray() : null;
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    throw error;
  }
}

/** A stored body as a web stream, for downloads. */
export async function streamBody(key: string): Promise<ReadableStream | null> {
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
    return out.Body?.transformToWebStream() ?? null;
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    throw error;
  }
}
