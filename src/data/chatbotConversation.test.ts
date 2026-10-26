import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatbotConversation, keywordHits, type ChatbotKnowledge } from './chatbotConversation';
import { DEFAULT_SITE_CONTENT } from './siteContent';
import type { ServicePackage } from './serviceCatalogue';
import type { WebsiteService } from './websiteServices';

const publishedService: WebsiteService = {
  id: 'service-google-ads',
  slug: 'google-ads',
  title: 'Google Ads',
  badge: 'Paid search',
  shortDescription: 'Manage paid search campaigns.',
  icon: 'search',
  deliverables: ['Campaign setup'],
  primaryCtaLabel: 'Explore',
  primaryCtaLink: '/services/google-ads',
  secondaryCtaLabel: 'Contact',
  secondaryCtaLink: '/contact',
  backgroundImageUrl: '',
  backgroundEnabled: false,
  backgroundFit: 'cover',
  backgroundOpacity: 1,
  backgroundPositionX: 50,
  backgroundPositionY: 50,
  displayOrder: 1,
  status: 'published',
};

const knowledge: ChatbotKnowledge = {
  siteContent: DEFAULT_SITE_CONTENT,
  services: [publishedService, { ...publishedService, id: 'draft-service', title: 'Draft service', status: 'draft' }],
  packages: [],
  blogPosts: [],
  caseStudies: [],
  availability: {
    siteContent: 'ready',
    services: 'ready',
    packages: 'ready',
    caseStudies: 'ready',
  },
};

const googleAdsPackage: ServicePackage = {
  id: 'google-ads-monthly',
  slug: 'google-ads-monthly',
  packageCode: 'GADS-MONTHLY',
  title: 'Google Ads Management',
  category: 'Paid advertising',
  packageKind: 'service',
  summary: 'Ongoing Google Ads campaign management.',
  description: 'Campaign setup and management.',
  priceInr: 12000,
  discountedPriceInr: null,
  billingType: 'monthly',
  imageUrl: '',
  deliverables: ['Campaign setup'],
  exclusions: [],
  clientRequirements: [],
  targetAudience: '',
  deliveryTimeline: '',
  faqs: [],
  featured: false,
  catalogueBadge: null,
  quantitySupported: false,
  status: 'published',
};

const searchPackage: ServicePackage = {
  ...googleAdsPackage,
  id: 'seo-monthly',
  slug: 'seo-monthly',
  packageCode: 'SEO-MONTHLY',
  title: 'SEO Management',
  category: 'Organic search',
  summary: 'Ongoing SEO campaign management.',
  description: 'Search optimization.',
  priceInr: 18000,
};

test('matches common one-character spelling errors', () => {
  assert.equal(keywordHits('Can you help with facebok ads?', ['facebook']), 1);
});

test('shows published services only and links to current service routes', () => {
  const conversation = new ChatbotConversation(knowledge);
  const turn = conversation.ask('services');
  assert.ok(turn);
  assert.match(turn.messages[0].text, /Google Ads/);
  assert.match(turn.messages[1].text, /Tap a service/);
  assert.doesNotMatch(turn.messages[0].text, /Draft service/);
  assert.equal(conversation.choose('service:google-ads').messages[0].href, '/services/google-ads');
});

test('offers published FAQs as selectable chips and answers from current site content', () => {
  const conversation = new ChatbotConversation(knowledge);
  conversation.greet();
  const menu = conversation.choose('faq-menu');
  assert.ok(menu.quickReplies.some((reply) => reply.id === `faq:${DEFAULT_SITE_CONTENT.faqs[0].id}`));
  const answer = conversation.choose(`faq:${DEFAULT_SITE_CONTENT.faqs[0].id}`);
  assert.equal(answer.messages[0].text, DEFAULT_SITE_CONTENT.faqs[0].answer);
});

test('matches service-specific pricing to the relevant published package', () => {
  const conversation = new ChatbotConversation({
    ...knowledge,
    packages: [googleAdsPackage, searchPackage, { ...googleAdsPackage, id: 'draft-package', title: 'Draft Google Ads', status: 'draft' }],
  });
  const turn = conversation.ask('What is the Google Ads pricing?');
  assert.ok(turn);
  assert.match(turn.messages[0].text, /Google Ads Management/);
  assert.match(turn.messages[0].text, /12,000/);
  assert.doesNotMatch(turn.messages[0].text, /SEO Management/);
  assert.doesNotMatch(turn.messages[0].text, /Draft Google Ads/);
  assert.equal(turn.quickReplies.some((reply) => reply.id === 'package:google-ads-monthly'), true);
});

test('repeated unknown questions retain one actionable handoff without duplicate options', () => {
  const conversation = new ChatbotConversation(knowledge);
  conversation.ask('zzzzx qqqwv');
  const repeated = conversation.ask('zzzzx qqqwv again');
  assert.ok(repeated);
  assert.equal(repeated.quickReplies.filter((reply) => reply.id.startsWith('lead-question:')).length, 1);
  assert.equal(repeated.quickReplies.find((reply) => reply.id.startsWith('lead-question:'))?.label, 'Send my question to the team');
});

test('does not invent a listed price when no published package matches the service', () => {
  const webService = { ...publishedService, slug: 'web-development', title: 'Web Development' };
  const conversation = new ChatbotConversation({
    ...knowledge,
    services: [webService],
    packages: [googleAdsPackage],
  });
  const turn = conversation.ask('What does web development cost?');
  assert.ok(turn);
  assert.match(turn.messages[0].text, /published package price specifically for Web Development/i);
  assert.doesNotMatch(turn.messages[0].text, /₹12,000/);
});

test('cancelling a lead flow leaves it inactive', () => {
  const conversation = new ChatbotConversation(knowledge);
  conversation.greet();
  conversation.choose('lead');
  assert.equal(conversation.currentLeadStep, 'consent');
  conversation.ask('Ravi Kumar');
  assert.equal(conversation.currentLeadStep, 'consent');
  conversation.choose('cancel');
  assert.equal(conversation.currentLeadStep, null);
  assert.match(conversation.ask('services')?.messages[0].text ?? '', /currently offers/);
});

test('lead collection does not depend on a WhatsApp destination', () => {
  const conversation = new ChatbotConversation({
    ...knowledge,
    siteContent: {
      ...DEFAULT_SITE_CONTENT,
      footerSettings: { ...DEFAULT_SITE_CONTENT.footerSettings, whatsappDestination: '' },
    },
  });
  conversation.greet();
  const turn = conversation.choose('lead');
  assert.equal(conversation.currentLeadStep, 'consent');
  assert.match(turn.messages[0].text, /saved to the NearGrow Ads enquiry inbox/i);
});

test('ordinary inquiry questions do not start lead collection without an explicit request', () => {
  const conversation = new ChatbotConversation(knowledge);
  conversation.greet();
  const turn = conversation.ask('Do you handle enquiries?');
  assert.equal(conversation.currentLeadStep, null);
  assert.ok(turn);
  assert.doesNotMatch(turn.messages[0].text, /Privacy Policy/);
});

test('lead submission maps provided contact and service details into the existing lead fields', () => {
  const conversation = new ChatbotConversation(knowledge);
  conversation.greet();
  conversation.ask('I need a quote for Google Ads');
  conversation.choose('lead-consent');
  conversation.ask('Alex Example');
  conversation.ask('+1 555 010 2028');
  conversation.ask('Example Studio');
  const submission = conversation.ask('alex@example.com')?.leadSubmission;
  assert.ok(submission);
  assert.equal(submission.name, 'Alex Example');
  assert.equal(submission.phone, '+1 555 010 2028');
  assert.equal(submission.businessName, 'Example Studio');
  assert.equal(submission.email, 'alex@example.com');
  assert.equal(submission.serviceInterest, 'Google Ads');
  assert.match(submission.message, /Visitor question: I need a quote for Google Ads/);
});

test('optional fields submit once, retry with the same identifier, and complete only after confirmation', () => {
  const conversation = new ChatbotConversation(knowledge);
  conversation.greet();
  conversation.choose('lead');
  conversation.choose('lead-consent');
  conversation.ask('Ravi Kumar');
  conversation.ask('+91 9876543210');
  conversation.choose('skip');
  const submissionTurn = conversation.choose('skip');
  assert.equal(submissionTurn.messages.length, 0);
  assert.ok(submissionTurn.leadSubmission);
  assert.equal(submissionTurn.leadSubmission.businessName, '');
  assert.equal(submissionTurn.leadSubmission.email, '');
  assert.equal(submissionTurn.leadSubmission.name, 'Ravi Kumar');
  assert.equal(submissionTurn.leadSubmission.serviceInterest, 'General enquiry');
  assert.match(submissionTurn.leadSubmission.message, /NEO Chatbot/);
  assert.equal(conversation.ask('Send again'), null);
  assert.deepEqual(conversation.choose('skip'), { messages: [], quickReplies: [] });

  const failure = conversation.leadSubmissionFailed(submissionTurn.leadSubmission.submissionId);
  assert.ok(failure);
  assert.ok(failure.quickReplies.some((reply) => reply.id === 'lead-retry'));
  const retry = conversation.choose('lead-retry');
  assert.equal(retry.leadSubmission?.submissionId, submissionTurn.leadSubmission.submissionId);
  assert.equal(retry.leadSubmission?.phone, '+91 9876543210');

  const completed = conversation.leadSubmissionSucceeded(
    submissionTurn.leadSubmission.submissionId,
    submissionTurn.leadSubmission.submissionId,
  );
  assert.equal(completed?.messages.length, 1);
  assert.match(completed?.messages[0].text ?? '', /has been saved/);
  assert.equal(conversation.leadSubmissionSucceeded(
    submissionTurn.leadSubmission.submissionId,
    submissionTurn.leadSubmission.submissionId,
  ), null);
  assert.ok(completed?.quickReplies.some((reply) => reply.id === 'new-inquiry'));

  const newInquiry = conversation.choose('new-inquiry');
  assert.equal(conversation.currentLeadStep, 'consent');
  assert.match(newInquiry.messages[0].text, /saved to the NearGrow Ads enquiry inbox/);

  const afterCompletion = new ChatbotConversation(knowledge);
  afterCompletion.greet();
  afterCompletion.choose('lead');
  afterCompletion.choose('lead-consent');
  afterCompletion.ask('Ravi Kumar');
  afterCompletion.ask('+91 9876543210');
  afterCompletion.choose('skip');
  const completedSubmission = afterCompletion.choose('skip').leadSubmission!;
  afterCompletion.leadSubmissionSucceeded(completedSubmission.submissionId, completedSubmission.submissionId);
  const anotherQuestion = afterCompletion.ask('services');
  assert.match(anotherQuestion?.messages[0].text ?? '', /currently offers/);
  assert.equal(afterCompletion.currentLeadStep, null);
  assert.equal(conversation.greet(), null);
});
