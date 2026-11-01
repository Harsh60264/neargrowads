import type { TeamMember } from './teamData';

export const MAX_MENTOR_SECTION_COPY_LENGTH = 2000;

export type OptionalMentorSectionCopy =
  | { valid: true; value?: string }
  | { valid: false };

export interface MentorSectionContent {
  overview: string;
  vision: string;
  insight: string;
}

const LEGACY_MENTOR_DETAILS: Record<string, Pick<MentorSectionContent, 'vision' | 'insight'>> = {
  'mentor-01': {
    vision: 'Make cross-border growth more intentional by pairing the right channels with messaging that feels local.',
    insight: 'A strong expansion plan starts with understanding the audience in each market.',
  },
  'mentor-02': {
    vision: 'Help growing teams build dependable technical foundations that support secure, sustainable delivery.',
    insight: 'Reliable architecture gives ambitious teams room to scale with confidence.',
  },
  'mentor-03': {
    vision: 'Turn search and measurement into a clearer view of performance across regions and languages.',
    insight: 'Useful measurement connects what audiences search for with the decisions teams make next.',
  },
  'mentor-04': {
    vision: 'Help brands move into new markets with focused go-to-market plans and purposeful partnerships.',
    insight: 'The best next market is the one where a clear opportunity meets a practical route to reach it.',
  },
};

export function validateOptionalMentorSectionCopy(value: unknown): OptionalMentorSectionCopy {
  if (value === undefined) return { valid: true };
  if (typeof value !== 'string' || value.length > MAX_MENTOR_SECTION_COPY_LENGTH) return { valid: false };
  return { valid: true, value: value.trim() };
}

export function resolveMentorSectionContent(
  member: Pick<TeamMember, 'id' | 'bio' | 'overview' | 'vision' | 'insight'>,
): MentorSectionContent {
  const legacy = LEGACY_MENTOR_DETAILS[member.id];
  return {
    overview: member.overview ?? member.bio,
    vision: member.vision ?? legacy?.vision ?? '',
    insight: member.insight ?? legacy?.insight ?? '',
  };
}
