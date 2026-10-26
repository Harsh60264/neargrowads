export interface ConsultationFormValidationValues {
  name: string;
  businessName: string;
  email: string;
  serviceInterest: string;
  message: string;
  consent: boolean;
}

export type ConsultationFormValidationMessage =
  | 'nameRequired'
  | 'nameLength'
  | 'businessRequired'
  | 'emailRequired'
  | 'emailInvalid'
  | 'serviceRequired'
  | 'messageRequired'
  | 'messageLength'
  | 'consent';

export type ConsultationFormValidationMessages = Record<ConsultationFormValidationMessage, string>;

export function validateConsultationForm(
  values: ConsultationFormValidationValues,
  messages: ConsultationFormValidationMessages,
): Partial<Record<keyof ConsultationFormValidationValues, string>> {
  const errors: Partial<Record<keyof ConsultationFormValidationValues, string>> = {};

  if (!values.name.trim()) {
    errors.name = messages.nameRequired;
  } else if (values.name.length > 80) {
    errors.name = messages.nameLength;
  }

  if (!values.businessName.trim()) errors.businessName = messages.businessRequired;

  if (!values.email.trim()) {
    errors.email = messages.emailRequired;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = messages.emailInvalid;
  }

  if (!values.serviceInterest) errors.serviceInterest = messages.serviceRequired;

  if (!values.message.trim()) {
    errors.message = messages.messageRequired;
  } else if (values.message.trim().length < 10) {
    errors.message = messages.messageLength;
  }

  if (!values.consent) errors.consent = messages.consent;

  return errors;
}
