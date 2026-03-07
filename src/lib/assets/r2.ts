import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_UPLOAD_URL_TTL_SECONDS = 600;
const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 600;

function getUploadUrlTtlSeconds(): number {
  const raw = Number(process.env.R2_UPLOAD_URL_TTL_SECONDS ?? DEFAULT_UPLOAD_URL_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_UPLOAD_URL_TTL_SECONDS;
  return Math.min(Math.floor(raw), 7 * 24 * 60 * 60);
}

function getDownloadUrlTtlSeconds(): number {
  const raw = Number(process.env.R2_DOWNLOAD_URL_TTL_SECONDS ?? DEFAULT_DOWNLOAD_URL_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DOWNLOAD_URL_TTL_SECONDS;
  return Math.min(Math.floor(raw), 7 * 24 * 60 * 60);
}

function getR2Client(): S3Client {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const region = process.env.R2_REGION || "auto";
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 env vars are missing");
  }

  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey }
  });
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET is required");
  return bucket;
}

export async function createPresignedPutUrl(input: {
  objectKey: string;
  mimeType: string;
}): Promise<{ url: string; expiresIn: number }> {
  const client = getR2Client();
  const expiresIn = getUploadUrlTtlSeconds();
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: input.objectKey,
    ContentType: input.mimeType
  });
  const url = await getSignedUrl(client, command, { expiresIn });
  return { url, expiresIn };
}

export async function createPresignedGetUrl(objectKey: string): Promise<{ url: string; expiresIn: number }> {
  const client = getR2Client();
  const expiresIn = getDownloadUrlTtlSeconds();
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: objectKey });
  const url = await getSignedUrl(client, command, { expiresIn });
  return { url, expiresIn };
}

export async function headObject(objectKey: string) {
  const client = getR2Client();
  return client.send(new HeadObjectCommand({ Bucket: getBucket(), Key: objectKey }));
}

export async function deleteObject(objectKey: string) {
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: objectKey }));
}

export async function listManagedObjects(continuationToken?: string) {
  const client = getR2Client();
  return client.send(
    new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: "tenant/",
      ContinuationToken: continuationToken,
      MaxKeys: 500
    })
  );
}
