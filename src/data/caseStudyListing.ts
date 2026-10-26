export function filterCaseStudies<T extends { category: string }>(studies: T[], selectedFilter: string): T[] {
  if (selectedFilter === 'all') return studies;
  if (!selectedFilter.startsWith('category:')) return [];

  const selectedCategory = normalizeCaseStudyCategoryName(selectedFilter.slice('category:'.length));
  return studies.filter((study) => normalizeCaseStudyCategoryName(study.category) === selectedCategory);
}

export function paginateCaseStudies<T>(studies: T[], currentPage: number): { pageCount: number; pageStudies: T[] } {
  return {
    pageCount: Math.ceil(studies.length / 3),
    pageStudies: studies.slice((currentPage - 1) * 3, currentPage * 3),
  };
}

export function normalizeCaseStudyCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}
