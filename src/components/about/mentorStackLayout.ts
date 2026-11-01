export const MAX_VISIBLE_MENTOR_STACK_LAYERS = 4;

export function getMentorStackLayer(index: number): number {
  return Math.min(Math.max(0, Math.floor(index)), MAX_VISIBLE_MENTOR_STACK_LAYERS - 1);
}

export function promoteMentor(mentorIds: string[], mentorId: string): string[] {
  const index = mentorIds.indexOf(mentorId);
  if (index <= 0) return mentorIds;
  return [mentorId, ...mentorIds.slice(0, index), ...mentorIds.slice(index + 1)];
}

export function cycleMentorIds(mentorIds: string[], direction: 1 | -1): string[] {
  if (mentorIds.length < 2) return mentorIds;
  return direction === 1
    ? [...mentorIds.slice(1), mentorIds[0]]
    : [mentorIds[mentorIds.length - 1], ...mentorIds.slice(0, -1)];
}
