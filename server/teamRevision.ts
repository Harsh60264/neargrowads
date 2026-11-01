import { createHash } from 'node:crypto';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function teamContentRevision(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function matchesTeamRevision(expectedRevision: string, currentMembers: unknown): boolean {
  return expectedRevision === teamContentRevision(currentMembers);
}
