export interface PartnerProfile {
  id: string;
  email: string;
  fullName: string;
  mobileNumber: string;
  status: 'pending' | 'active' | 'disabled';
}
