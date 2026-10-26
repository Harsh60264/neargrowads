import seed from './team.seed.json';
import { teamUrlKind } from './teamLinks';

export type TeamGroup = 'mentor' | 'core';

export interface TeamMember {
  id: string;
  group: TeamGroup;
  name: string;
  role: string;
  tag?: string;
  bio: string;
  imageUrl: string;
  socialUrl: string;
  order: number;
  visible: boolean;
}

/** Bundled fallback so the section renders offline / before the API responds. */
export const TEAM_SEED = seed as unknown as TeamMember[];

export const sortTeam = (list: TeamMember[]) =>
  [...list].sort((a, b) => (a.group === b.group ? a.order - b.order : a.group === 'mentor' ? -1 : 1));

/** Public site: visible members only, sorted. Uses the seed only when the API is unavailable. */
export async function fetchTeam(): Promise<TeamMember[]> {
  try {
    const response = await fetch('/api/team', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as { members: TeamMember[] };
      if (Array.isArray(data.members)) return sortTeam(data.members);
    }
  } catch {
    // Keep rendering the bundled seed.
  }
  return sortTeam(TEAM_SEED.filter((member) => member.visible));
}

export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'NG';

export const socialKind = (url: string): 'linkedin' | 'web' | 'none' => {
  return teamUrlKind(url);
};
