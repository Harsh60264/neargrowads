export type PartnerLocationSource = 'gps_reverse_geocoded' | 'gps_manual' | 'manual_no_gps';

export interface PartnerLocationComponents {
  locality: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface PartnerLocation {
  address: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string | null;
  source: PartnerLocationSource;
  components: PartnerLocationComponents | null;
}

export interface PartnerLocationSubmission extends PartnerLocation {
  locationToken?: string;
}
