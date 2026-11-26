import { normalizePartnerMobile, normalizePartnerName } from './partnerAuth';

export interface PartnerProofPhoto {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Buffer;
}

export interface PartnerCoinLedgerEntry {
  entry_type: 'earning' | 'withdrawal';
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'requested' | 'settled';
}

export interface PartnerCoinSummary {
  balance: number;
  totalEarned: number;
  totalWithdrawn: number;
  pendingApproval: number;
}

const MAX_PARTNER_PROOF_BYTES = 2 * 1024 * 1024;
const PARTNER_PROOF_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export function parsePartnerProofPhoto(value: unknown): PartnerProofPhoto | undefined {
  if (typeof value !== 'string') return undefined;
  const match = PARTNER_PROOF_DATA_URL.exec(value);
  if (!match) return undefined;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_PARTNER_PROOF_BYTES ||
    bytes.toString('base64') !== match[2]) return undefined;
  const contentType = match[1] as PartnerProofPhoto['contentType'];
  const isJpeg = contentType === 'image/jpeg' && bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = contentType === 'image/png' && bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = contentType === 'image/webp' && bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) return undefined;
  return { contentType, bytes };
}

export function normalizePartnerProfileUpdate(value: unknown): {
  fullName: string;
  mobileNumber: string;
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const fullName = normalizePartnerName(input.fullName);
  const mobileNumber = normalizePartnerMobile(input.mobileNumber);
  if (!fullName || !mobileNumber) return undefined;
  return { fullName, mobileNumber };
}

export function summarizePartnerCoins(entries: readonly PartnerCoinLedgerEntry[]): PartnerCoinSummary {
  let balance = 0;
  let totalEarned = 0;
  let totalWithdrawn = 0;
  let pendingApproval = 0;

  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amount)) continue;
    if (entry.entry_type === 'earning') {
      if (entry.status === 'approved' || entry.status === 'settled') {
        balance += entry.amount;
        totalEarned += entry.amount;
      } else if (entry.status === 'pending') {
        pendingApproval += entry.amount;
      }
    } else if (entry.entry_type === 'withdrawal') {
      if (entry.status === 'requested' || entry.status === 'settled') {
        balance += entry.amount;
      }
      if (entry.status === 'settled') totalWithdrawn -= entry.amount;
    }
  }

  return { balance, totalEarned, totalWithdrawn, pendingApproval };
}
