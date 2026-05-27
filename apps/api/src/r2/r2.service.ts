import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

// R2 is S3-compatible. We use the AWS SDK and point its endpoint at the
// Cloudflare-issued account endpoint. R2 uses the literal region 'auto'.
//
// All four env vars must be present for uploads/downloads to work. The
// service constructs without them (lazy init) so the API boots in dev
// even when R2 isn't provisioned; calls to generate* throw a 503 with a
// clear message when env is missing.

@Injectable()
export class R2Service {
  private readonly log = new Logger(R2Service.name);
  private client: S3Client | null = null;
  private readonly bucket: string | undefined;

  constructor() {
    this.bucket = process.env.R2_BUCKET_NAME;
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (accountId && accessKeyId && secretAccessKey && this.bucket) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.log.log('R2 client initialised');
    } else {
      this.log.warn(
        'R2 env vars missing; file upload/download endpoints will 503 until ' +
          'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME are set.',
      );
    }
  }

  private requireClient(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException(
        'File storage is not configured on this server. Set R2_* environment variables.',
      );
    }
    return { client: this.client, bucket: this.bucket };
  }

  /**
   * Returns a pre-signed PUT URL the client can upload to directly.
   * The signature pins content-type and (optionally) content-length so
   * the client can't switch them mid-upload.
   *
   *   contentType  — required; the browser must send this exact header
   *   maxSize      — optional; sets ContentLength so R2 rejects anything larger
   *   ttlSeconds   — URL lifetime; default 900s (15 min)
   */
  async generatePresignedUploadUrl(args: {
    key: string;
    contentType: string;
    maxSize?: number;
    ttlSeconds?: number;
  }): Promise<{ url: string; headers: Record<string, string>; expiresInSeconds: number }> {
    const { client, bucket } = this.requireClient();
    const expiresIn = args.ttlSeconds ?? 900;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      ContentType: args.contentType,
      ...(args.maxSize !== undefined ? { ContentLength: args.maxSize } : {}),
    });

    const url = await getSignedUrl(client, command, { expiresIn });

    // The client must send these headers exactly when PUTting; otherwise
    // R2 rejects with SignatureDoesNotMatch.
    const headers: Record<string, string> = { 'content-type': args.contentType };
    if (args.maxSize !== undefined) headers['content-length'] = String(args.maxSize);

    return { url, headers, expiresInSeconds: expiresIn };
  }

  /**
   * Returns a pre-signed GET URL for a short-lived download. Authorization
   * (whether THIS user is allowed to read this key) must be checked by
   * the caller before invoking — this method only signs.
   *
   *   ttlSeconds   — URL lifetime; default 300s (5 min). Keep short so a
   *                  leaked URL has a small blast radius.
   */
  async generatePresignedDownloadUrl(args: {
    key: string;
    ttlSeconds?: number;
  }): Promise<{ url: string; expiresInSeconds: number }> {
    const { client, bucket } = this.requireClient();
    const expiresIn = args.ttlSeconds ?? 300;

    const command = new GetObjectCommand({ Bucket: bucket, Key: args.key });
    const url = await getSignedUrl(client, command, { expiresIn });
    return { url, expiresInSeconds: expiresIn };
  }

  /** True if R2 credentials are configured. Used by /health and tests. */
  isConfigured(): boolean {
    return this.client !== null && !!this.bucket;
  }
}
