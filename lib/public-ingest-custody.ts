import { createHash } from 'node:crypto';
import { open, lstat, realpath, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Receipt } from './public-ingest-core';

const HEX64 = /^[0-9a-f]{64}$/;
const TASK = 'ADHOC-2026-09-26-media-intelligence';
function hold(): never { throw new Error('HOLD: public ingest custody prerequisite'); }
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function owned(path: string, kind: 'file' | 'dir'): Promise<void> {
  let st;
  try { st = await lstat(path); } catch { return hold(); }
  if (st.isSymbolicLink() || st.uid !== process.getuid?.()
      || (kind === 'file' ? !st.isFile() || (st.mode & 0o777) !== 0o600
        : !st.isDirectory() || (st.mode & 0o077) !== 0)
      || await realpath(path) !== resolve(path)) hold();
}

export type Custody = { receiptDir: string; candidateSha256: string;
  projectId: number; ownerId: number; rssUrl: string; keyword: string; now: () => Date };

export function validActivationRecord(record: Record<string, unknown>, c: Custody): boolean {
  return record.task === TASK && record.candidateSha256 === c.candidateSha256
    && record.projectId === c.projectId && record.ownerId === c.ownerId
    && record.rssUrlSha256 === sha(c.rssUrl)
    && record.keywordSha256 === sha(c.keyword)
    && HEX64.test(String(record.coldBackupManifestSha256 ?? ''))
    && HEX64.test(String(record.restoreDrillSha256 ?? ''))
    && record.approved === true;
}

function paths(c: Custody): { root: string; activation: string } {
  const db = process.env.PGLITE_DIR;
  if (!db || !db.startsWith('/') || !db.endsWith('/data/pglite')) hold();
  const root = dirname(dirname(db));
  const configuredRoot = process.env.RADAR_PUBLIC_INGEST_ROOT;
  if (!configuredRoot || !configuredRoot.startsWith('/') || resolve(configuredRoot) !== configuredRoot || root !== configuredRoot
      || c.receiptDir !== join(root, 'public-ingest-receipts')
      || !HEX64.test(c.candidateSha256)
      || !Number.isSafeInteger(c.projectId) || c.projectId <= 0
      || !Number.isSafeInteger(c.ownerId) || c.ownerId <= 0) hold();
  return { root, activation: join(c.receiptDir, 'activation.json') };
}

/** One-time protected cold-backup/restore approval; exact installed candidate.json bytes. */
export async function verifyPublicActivation(c: Custody): Promise<void> {
  const { root, activation } = paths(c);
  await owned(root, 'dir');
  await owned(c.receiptDir, 'dir');
  await owned(join(root, 'candidate.json'), 'file');
  await owned(activation, 'file');
  let record: Record<string, unknown>;
  try {
    if (sha(await readFile(join(root, 'candidate.json'))) !== c.candidateSha256) hold();
    const raw = await readFile(activation);
    if (raw.length > 4_096) hold();
    record = JSON.parse(raw.toString('utf8'));
  } catch { return hold(); }
  if (!validActivationRecord(record, c)) hold();
}

/** Hash the exact synthetic project's pre-batch rows; never log the rows. */
export function hashProjectRows(rows: unknown[]): string {
  if (!Array.isArray(rows) || rows.length > 500) hold();
  const json = JSON.stringify(rows);
  if (Buffer.byteLength(json, 'utf8') > 1_000_000) hold();
  return sha(json);
}

/** Save exact pre-batch rows after the O_EXCL attempt is consumed. */
export async function saveProjectSnapshot(c: Custody, day: string, rows: unknown[]): Promise<Receipt> {
  paths(c);
  await owned(c.receiptDir, 'dir');
  if (day !== c.now().toISOString().slice(0, 10)) hold();
  const dataSha256 = hashProjectRows(rows);
  const receipt: Receipt = { candidateSha256: c.candidateSha256, dataSha256,
    verifiedAt: c.now().toISOString(), transactionRollbackReady: true };
  const snapshot = { task: TASK, projectId: c.projectId, ownerId: c.ownerId, utcDay: day,
    ...receipt, rowCount: rows.length, rows };
  const path = join(c.receiptDir, `${c.candidateSha256}-p${c.projectId}-${day}-snapshot.json`);
  let file;
  try { file = await open(path, 'wx', 0o600); } catch { return hold(); }
  try { await file.writeFile(JSON.stringify(snapshot) + '\n'); await file.sync(); }
  finally { await file.close(); }
  const dir = await open(c.receiptDir, 'r');
  try { await dir.sync(); } finally { await dir.close(); }
  return receipt;
}

/** O_EXCL receipt is an attempt record, retained even when work fails or times out. */
export async function withPublicDayLease<T>(c: Custody, day: string, work: () => Promise<T>): Promise<T> {
  paths(c);
  await owned(c.receiptDir, 'dir');
  if (day !== c.now().toISOString().slice(0, 10)) hold();
  const name = `${c.candidateSha256}-p${c.projectId}-${day}.json`;
  let file;
  try { file = await open(join(c.receiptDir, name), 'wx', 0o600); } catch { return hold(); }
  try {
    await file.writeFile(JSON.stringify({ task: TASK, candidateSha256: c.candidateSha256,
      projectId: c.projectId, ownerId: c.ownerId, utcDay: day,
      startedAt: c.now().toISOString(), status: 'ATTEMPT_CONSUMED' }) + '\n');
    await file.sync();
  } finally { await file.close(); }
  const dir = await open(c.receiptDir, 'r');
  try { await dir.sync(); } finally { await dir.close(); }
  return work();
}
