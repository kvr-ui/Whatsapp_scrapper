import { ZipArchive } from 'archiver';

/**
 * Bundles the split CSV parts into a single ZIP the browser can download in
 * one click. Buffered rather than streamed: a campaign export is a few hundred
 * kilobytes, well inside a function's memory budget, and buffering keeps the
 * route a plain Response.
 */
export async function zipFiles(files: { name: string; body: string }[]): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];

  archive.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });

  for (const f of files) archive.append(Buffer.from(f.body, 'utf8'), { name: f.name });
  await archive.finalize();
  await finished;

  return Buffer.concat(chunks);
}
