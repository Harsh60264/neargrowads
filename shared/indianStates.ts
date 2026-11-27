export const INDIAN_STATES_AND_UNION_TERRITORIES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'National Capital Territory of Delhi',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;

export type IndianStateOrUnionTerritory = typeof INDIAN_STATES_AND_UNION_TERRITORIES[number];

export function normalizeIndianState(value: unknown): IndianStateOrUnionTerritory | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLocaleLowerCase('en-IN');
  return INDIAN_STATES_AND_UNION_TERRITORIES.find(
    (state) => state.toLocaleLowerCase('en-IN') === normalized,
  );
}

export function normalizeDetectedIndianState(value: unknown): IndianStateOrUnionTerritory | undefined {
  const canonical = normalizeIndianState(value);
  if (canonical || typeof value !== 'string') return canonical;
  const detected = value.trim().toLocaleLowerCase('en-IN');
  const aliases: Record<string, IndianStateOrUnionTerritory> = {
    'andaman & nicobar islands': 'Andaman and Nicobar Islands',
    'dadra and nagar haveli and daman & diu': 'Dadra and Nagar Haveli and Daman and Diu',
    delhi: 'National Capital Territory of Delhi',
    'nct of delhi': 'National Capital Territory of Delhi',
    orissa: 'Odisha',
    pondicherry: 'Puducherry',
    uttaranchal: 'Uttarakhand',
  };
  return aliases[detected];
}
