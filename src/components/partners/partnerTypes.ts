export interface PartnerProfile {
  id: string;
  email: string;
  fullName: string;
  mobileNumber: string;
  state: string | null;
  preferredDeliveryAreas: string[];
  status: 'pending' | 'active' | 'disabled';
}
