import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateConsultationForm,
  type ConsultationFormValidationMessages,
  type ConsultationFormValidationValues,
} from './consultationFormValidation';

const messages: ConsultationFormValidationMessages = {
  nameRequired: 'name-required',
  nameLength: 'name-too-long',
  businessRequired: 'business-required',
  emailRequired: 'email-required',
  emailInvalid: 'email-invalid',
  serviceRequired: 'service-required',
  messageRequired: 'message-required',
  messageLength: 'message-too-short',
  consent: 'consent-required',
};

const validValues: ConsultationFormValidationValues = {
  name: 'Avery Example',
  businessName: 'Example Studio',
  email: 'avery@example.com',
  serviceInterest: 'seo',
  message: 'Please help grow our local business.',
  consent: true,
};

test('requires each mandatory consultation field and consent', () => {
  assert.deepEqual(validateConsultationForm({
    name: ' ',
    businessName: '',
    email: '',
    serviceInterest: '',
    message: '\n',
    consent: false,
  }, messages), {
    name: 'name-required',
    businessName: 'business-required',
    email: 'email-required',
    serviceInterest: 'service-required',
    message: 'message-required',
    consent: 'consent-required',
  });
});

test('accepts valid consultation values and checks name/message boundaries', () => {
  assert.deepEqual(validateConsultationForm(validValues, messages), {});
  assert.equal(validateConsultationForm({ ...validValues, name: 'x'.repeat(80) }, messages).name, undefined);
  assert.equal(validateConsultationForm({ ...validValues, name: 'x'.repeat(81) }, messages).name, 'name-too-long');
  assert.equal(validateConsultationForm({ ...validValues, message: '123456789' }, messages).message, 'message-too-short');
  assert.equal(validateConsultationForm({ ...validValues, message: '1234567890' }, messages).message, undefined);
});

test('rejects malformed email addresses after trimming surrounding whitespace', () => {
  assert.equal(validateConsultationForm({ ...validValues, email: 'avery@example.com ' }, messages).email, undefined);
  assert.equal(validateConsultationForm({ ...validValues, email: 'not-an-email' }, messages).email, 'email-invalid');
});
