import type { PartnerLocation } from '../../../shared/partnerLocation';

export interface PartnerProfile {
  id: string;
  email: string;
  fullName: string;
  mobileNumber: string;
  state: string | null;
  preferredDeliveryAreas: string[];
  registrationLocation: PartnerLocation | null;
  currentLocation: PartnerLocation | null;
  status: 'pending' | 'active' | 'disabled';
}
