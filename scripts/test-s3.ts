import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const region = process.env.AWS_REGION ?? 'us-west-2';
const bucket = process.env.AWS_BUCKET;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

if (!bucket || !accessKeyId || !secretAccessKey) {
  console.error('Missing AWS env vars. Need AWS_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.');
  process.exit(1);
}

const client = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

const testKey = `test-cpl-upload-${Date.now()}.txt`;

async function main() {
  console.log(`Bucket: ${bucket}`);
  console.log(`Region: ${region}`);
  console.log(`Access key: ${accessKeyId.slice(0, 8)}...`);

  try {
    const listResult = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      MaxKeys: 5,
    }));

    const keys = (listResult.Contents ?? []).map((obj) => obj.Key).filter(Boolean);
    console.log(`ListObjectsV2: success (${keys.length} objects shown)`);
    for (const key of keys) {
      console.log(`  - ${key}`);
    }
  } catch (error) {
    console.error('ListObjectsV2: failed');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: testKey,
      Body: 'CPL upload test',
      ContentType: 'text/plain',
    }));
    console.log(`PutObject: success (${testKey})`);
  } catch (error) {
    console.error('PutObject: failed');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  try {
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: testKey,
    }));
    console.log(`DeleteObject: success (${testKey})`);
  } catch (error) {
    console.error('DeleteObject: failed');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log('S3 test complete: success');
}

main().catch((error) => {
  console.error('Unexpected failure');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
