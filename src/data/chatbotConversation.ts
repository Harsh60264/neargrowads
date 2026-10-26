import type { BlogPost } from './blogData';
import type { CaseStudy } from './caseStudiesData';
import type { ServicePackage } from './serviceCatalogue';
import type { SiteContent, PublicFaq } from './siteContent';
import type { WebsiteService } from './websiteServices';
import { billingTypeLabel, finalServicePrice, formatServicePrice } from './serviceCatalogue';
import { isSafePublicDestination } from './publicLinks';

export interface ChatbotKnowledge {
  siteContent: SiteContent;
  services?: WebsiteService[];
  packages?: ServicePackage[];
  blogPosts: BlogPost[];
  caseStudies?: CaseStudy[];
  whatsappNumber?: string;
  availability?: {
    siteContent: 'loading' | 'ready';
    services: 'loading' | 'ready' | 'unavailable';
    packages: 'loading' | 'ready' | 'unavailable';
    caseStudies: 'loading' | 'ready' | 'unavailable';
  };
}

export interface ChatbotMessage {
  text: string;
  href?: string;
}

export interface ChatbotQuickReply {
  id: string;
  label: string;
}

export interface ChatbotLeadSubmission {
  submissionId: string;
  name: string;
  phone: string;
  businessName: string;
  email: string;
  serviceInterest: string;
  message: string;
}

export interface ChatbotTurn {
  messages: ChatbotMessage[];
  quickReplies: ChatbotQuickReply[];
  leadSubmission?: ChatbotLeadSubmission;
}

interface LeadDetails {
  offer: string;
  question: string;
  name?: string;
  phone?: string;
  business?: string;
  email?: string;
}

type LeadStep = 'consent' | 'name' | 'phone' | 'business' | 'email';
type LeadFlowStatus = 'collecting' | 'submitting' | 'failed' | 'completed' | 'cancelled';

interface LeadFlow {
  step: LeadStep;
  status: LeadFlowStatus;
  details: LeadDetails;
  submissionId?: string;
}

const normalize = (value: string): string => value
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function keywordHits(input: string, keywords: string[]): number {
  const normalized = normalize(input);
  const tokens = normalized.split(' ').filter(Boolean);
  return keywords.reduce((count, keyword) => {
    const term = normalize(keyword.replace(/\*$/, ''));
    if (!term) return count;
    const matched = keyword.endsWith('*')
      ? tokens.some((token) => token.startsWith(term))
      : term.includes(' ')
        ? ` ${normalized} `.includes(` ${term} `)
        : tokens.includes(term) || (term.length >= 5 && tokens.some((token) =>
          token.length >= 4 && Math.abs(token.length - term.length) <= 2 &&
          levenshtein(token, term) <= (term.length >= 9 ? 2 : 1)));
    return count + Number(matched);
  }, 0);
}

function safeWhatsappNumber(knowledge: ChatbotKnowledge): string | undefined {
  const apiNumber = knowledge.whatsappNumber?.replace(/\D/g, '');
  if (apiNumber && /^[0-9]{8,15}$/.test(apiNumber)) return apiNumber;
  if (knowledge.availability?.siteContent === 'loading') return undefined;
  const destination = knowledge.siteContent.footerSettings.whatsappDestination;
  if (!isSafePublicDestination(destination)) return undefined;
  const match = /^https:\/\/wa\.me\/([0-9]{8,15})(?:[/?#]|$)/i.exec(destination);
  return match?.[1];
}

function packagePrice(item: ServicePackage): string {
  return `${formatServicePrice(finalServicePrice(item))} / ${billingTypeLabel[item.billingType].toLowerCase()}`;
}

const BASE_MENU: ChatbotQuickReply[] = [
  { id: 'services', label: 'Services' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'consultation', label: 'Consultation' },
  { id: 'faq-menu', label: 'FAQs' },
  { id: 'about', label: 'Case studies' },
  { id: 'blog', label: 'Blog' },
  { id: 'lead', label: 'Send to team' },
  { id: 'contact', label: 'Contact details' },
];

export class ChatbotConversation {
  private knowledge: ChatbotKnowledge;
  private greeted = false;
  private missCount = 0;
  private currentOffer = '';
  private handoffUrl = '';
  private leadFlow: LeadFlow | null = null;
  private quickReplies: ChatbotQuickReply[] = [];

  constructor(knowledge: ChatbotKnowledge) {
    this.knowledge = knowledge;
  }

  updateKnowledge(knowledge: ChatbotKnowledge): void {
    this.knowledge = knowledge;
  }

  greet(): ChatbotTurn | null {
    if (this.greeted) return null;
    this.greeted = true;
    return this.turn(
      [{ text: "Hi! I'm NEO, the NearGrow Ads assistant. Choose an option below or type your question." }],
      BASE_MENU,
    );
  }

  choose(actionId: string): ChatbotTurn {
    if (this.leadFlow?.status === 'submitting') return { messages: [], quickReplies: [] };
    const action = this.quickReplies.find((candidate) => candidate.id === actionId);
    this.quickReplies = [];
    if (!action) return this.respondUnknown('');
    switch (action.id) {
      case 'services': return this.services();
      case 'pricing': return this.pricing();
      case 'consultation': return this.consultation();
      case 'lead': return this.startLead();
      case 'contact': return this.contact();
      case 'human': return this.human();
      case 'blog': return this.blog();
      case 'about': return this.about();
      case 'faq':
        return this.faq(this.knowledge.siteContent.faqs[0]);
      case 'faq-menu':
        return this.faqMenu();
      case 'route-services':
        return this.reply('Open the current Services page to explore published service details.', BASE_MENU, '/services');
      case 'route-catalogue':
        return this.reply('Open the current Catalogue to view published packages and enquiry options.', BASE_MENU, '/catalogue');
      case 'route-work':
        return this.reply('Open the Work page to explore published case studies.', BASE_MENU, '/work');
      case 'route-blog':
        return this.reply('Open the Blog to browse published articles.', BASE_MENU, '/blog');
      case 'route-blog-post':
        return this.blog();
      case 'consultation-link': {
        const destination = this.knowledge.siteContent.ctaDestinations?.['header.consultation'] || '';
        return this.reply(
          `Open the ${this.knowledge.siteContent.contactPage.primaryCta || 'consultation'} request form.`,
          BASE_MENU,
          isSafePublicDestination(destination)
            ? destination
            : '/get-started',
        );
      }
      case 'contact-phone':
        return this.contactDestination('phone');
      case 'contact-email':
        return this.contactDestination('email');
      case 'contact-whatsapp':
        return this.contactDestination('whatsapp');
      case 'whatsapp-handoff':
        return this.handoffUrl
          ? this.reply('WhatsApp will open with the prepared message. Review it and choose Send in WhatsApp; nothing has been sent yet.', BASE_MENU, this.handoffUrl)
          : this.reply('The WhatsApp handoff is unavailable right now. Your details are still only in this chat.', BASE_MENU);
      case 'catalogue':
        return this.reply(
          'Open the Catalogue to add published packages to its cart, submit an enquiry, or review available checkout options. This chat does not add items to the cart.',
          BASE_MENU,
          '/catalogue',
        );
      case 'skip':
        return this.advanceLead('skip');
      case 'cancel':
        return this.cancelLead();
      case 'lead-retry':
        return this.retryLeadSubmission();
      case 'ask-question':
        return this.reply('What would you like to know?', BASE_MENU);
      case 'new-inquiry':
        return this.startLead();
      case 'lead-consent':
        return this.acceptLeadConsent();
      case 'main-menu':
        return this.reply('What would you like to explore?', BASE_MENU);
      case 'audit':
        return this.consultation();
      case 'website':
        return this.website();
      default:
        if (action.id.startsWith('service:')) return this.service(action.id.slice('service:'.length));
        if (action.id.startsWith('package:')) return this.package(action.id.slice('package:'.length));
        if (action.id.startsWith('faq:')) return this.faq(this.knowledge.siteContent.faqs.find((faq) => faq.id === action.id.slice(4)));
        if (action.id.startsWith('blog:')) return this.blogPost(action.id.slice(5));
        if (action.id.startsWith('case:')) return this.caseStudy(action.id.slice(5));
        if (action.id.startsWith('lead-question:')) return this.startLead('', action.id.slice('lead-question:'.length));
        if (action.id.startsWith('lead:')) return this.startLead(action.id.slice(5));
        if (action.id.startsWith('route:')) return this.reply('Open this page for more information.', BASE_MENU, action.id.slice(6));
        return this.respondUnknown('');
    }
  }

  ask(rawInput: string): ChatbotTurn | null {
    const input = rawInput.trim().slice(0, 300);
    if (!input) return null;
    if (this.leadFlow?.status === 'submitting') return null;
    if (this.leadFlow?.status === 'failed') {
      const normalized = normalize(input);
      if (['retry', 'try again', 'submit again'].includes(normalized)) return this.retryLeadSubmission();
      if (/^(cancel|stop|exit|quit|menu|main menu|back|never mind|nevermind)$/.test(normalized)) return this.cancelLead();
      return this.reply('Your details are still here, but I could not save the enquiry. Choose Retry to try again, or Cancel to discard it.', [
        { id: 'lead-retry', label: 'Retry' },
        { id: 'cancel', label: 'Cancel' },
      ]);
    }
    if (this.leadFlow?.status === 'collecting') return this.advanceLead(input);
    return this.respond(input);
  }

  get currentLeadStep(): LeadStep | null {
    return this.leadFlow?.status === 'collecting' ? this.leadFlow.step : null;
  }

  leadSubmissionSucceeded(submissionId: string, savedLeadId: string): ChatbotTurn | null {
    const flow = this.leadFlow;
    if (!flow || flow.status !== 'submitting' || flow.submissionId !== submissionId ||
      !savedLeadId || savedLeadId !== submissionId) return null;
    flow.status = 'completed';
    const handoffLines = [
      'New enquiry | NearGrow Ads',
      '',
      `Name: ${flow.details.name || ''}`,
      `Phone: ${flow.details.phone || ''}`,
      ...(flow.details.business ? [`Business: ${flow.details.business}`] : []),
      ...(flow.details.email ? [`Email: ${flow.details.email}`] : []),
      `Service or offer: ${flow.details.offer || 'Not specified'}`,
      ...(flow.details.question ? [`Question: ${flow.details.question}`] : []),
      'Saved through the NEO Chatbot.',
    ];
    const whatsappNumber = safeWhatsappNumber(this.knowledge);
    this.handoffUrl = whatsappNumber
      ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(handoffLines.join('\n'))}`
      : '';
    return this.turn(
      [{ text: `Thank you, ${flow.details.name || 'there'}. Your enquiry has been saved for the NearGrow Ads team. Reference: ${savedLeadId}` }],
      [
        ...(this.handoffUrl ? [{ id: 'whatsapp-handoff', label: 'Open WhatsApp' }] : []),
        { id: 'ask-question', label: 'Ask another question' },
        { id: 'new-inquiry', label: 'Start a new inquiry' },
      ],
    );
  }

  leadSubmissionFailed(submissionId: string): ChatbotTurn | null {
    const flow = this.leadFlow;
    if (!flow || flow.status !== 'submitting' || flow.submissionId !== submissionId) return null;
    flow.status = 'failed';
    return this.reply('I could not save your enquiry just now. Your answers are still here. Choose Retry to try again, or Cancel to discard them.', [
      { id: 'lead-retry', label: 'Retry' },
      { id: 'cancel', label: 'Cancel' },
    ]);
  }

  private turn(messages: ChatbotMessage[], quickReplies: ChatbotQuickReply[] = []): ChatbotTurn {
    this.quickReplies = quickReplies;
    return { messages, quickReplies };
  }

  private reply(text: string, quickReplies: ChatbotQuickReply[] = BASE_MENU, href?: string): ChatbotTurn {
    return this.turn([{ text, ...(href && isSafePublicDestination(href) ? { href } : {}) }], quickReplies);
  }

  private serviceActions(): ChatbotQuickReply[] {
    const services = this.knowledge.services?.filter((service) => service.status === 'published');
    if (!services) return [{ id: 'services', label: 'Services' }, { id: 'contact', label: 'Contact details' }];
    return [
      ...services.map((service) => ({ id: `service:${service.slug}`, label: service.title })),
      { id: 'pricing', label: 'Pricing' },
      { id: 'main-menu', label: 'Main menu' },
    ];
  }

  private services(): ChatbotTurn {
    if (!this.knowledge.services) {
      const message = this.knowledge.availability?.services === 'loading'
        ? 'I’m loading current published service information. You can open the Services page or contact the team in the meantime.'
        : 'Current published service information is unavailable right now. You can still explore the Services page or contact our team.';
      return this.reply(message, [
        { id: 'route-services', label: 'Open Services page' },
        { id: 'contact', label: 'Contact details' },
      ]);
    }
    const services = this.knowledge.services.filter((service) => service.status === 'published');
    if (!services.length) {
      return this.reply('No published service details are available at the moment. Please contact our team for current information.', [
        { id: 'contact', label: 'Contact details' },
        { id: 'main-menu', label: 'Main menu' },
      ]);
    }
    const lines = services.map((service) => `• ${service.title}: ${service.shortDescription}`);
    return this.turn([
      { text: `Here is what NearGrow Ads currently offers:\n${lines.join('\n')}` },
      { text: 'Tap a service to learn more.' },
    ], [
      ...this.serviceActions(),
      { id: 'consultation', label: 'Consultation' },
    ]);
  }

  private service(slug: string): ChatbotTurn {
    const service = this.knowledge.services?.find((item) => item.slug === slug && item.status === 'published');
    if (!service) return this.services();
    this.currentOffer = service.title;
    const details = [
      service.title,
      service.shortDescription,
      ...(service.deliverables.length ? [`Published scope:\n${service.deliverables.map((item) => `• ${item}`).join('\n')}`] : []),
      'The team can confirm the scope and fit for your business.',
    ].join('\n\n');
    return this.reply(details, [
      { id: `lead:${service.title}`, label: 'Get a quote' },
      { id: 'pricing', label: 'Pricing' },
      { id: 'catalogue', label: 'Browse packages' },
      { id: 'services', label: 'Other services' },
      { id: 'human', label: 'Talk to a human' },
    ], `/services/${service.slug}`);
  }

  private pricing(service?: WebsiteService, matchingPackage?: ServicePackage): ChatbotTurn {
    if (!this.knowledge.packages) {
      const message = this.knowledge.availability?.packages === 'loading'
        ? 'I’m loading current published package pricing. You can open the Catalogue or contact the team in the meantime.'
        : 'Published package pricing is unavailable right now. I won’t guess a price; please check the Catalogue or contact our team.';
      return this.reply(message, [
        { id: 'route-catalogue', label: 'Open Catalogue' },
        { id: 'lead', label: 'Ask for a quote' },
        { id: 'main-menu', label: 'Main menu' },
      ]);
    }
    const packages = this.knowledge.packages.filter((item) => item.status === 'published');
    if (!packages.length) {
      return this.reply('No published package prices are currently listed. Our team can discuss a scope-specific quote.', [
        { id: 'lead', label: 'Ask for a quote' },
        { id: 'route-catalogue', label: 'Open Catalogue' },
        { id: 'main-menu', label: 'Main menu' },
      ]);
    }
    if (service) {
      const serviceTitle = normalize(service.title);
      const serviceTerms = serviceTitle.split(' ').filter((word) => word.length > 2);
      const relatedPackages = packages.map((item) => ({
        item,
        score: (() => {
          const packageText = normalize(
            `${item.title} ${item.slug.replace(/-/g, ' ')} ${item.category} ${item.summary} ${item.description}`,
          );
          if (!serviceTitle) return 0;
          return packageText.includes(serviceTitle) ? 10 : keywordHits(packageText, serviceTerms);
        })(),
      })).filter(({ score }) => score >= Math.max(1, Math.min(2, serviceTerms.length))).sort((left, right) => right.score - left.score);
      if (!relatedPackages.length) {
        return this.reply(
          `I could not find a published package price specifically for ${service.title}. The team can confirm a quote based on your requirements.`,
          [
            { id: `lead:${service.title}`, label: 'Ask for a quote' },
            { id: 'route-catalogue', label: 'Browse all packages' },
            { id: 'main-menu', label: 'Main menu' },
          ],
        );
      }
      const matched = relatedPackages.map(({ item }) => item);
      return this.turn([
        { text: `Published package pricing related to ${service.title}:\n${matched.map((item) => `• ${item.title}: ${packagePrice(item)}`).join('\n')}` },
        { text: 'Tap a package for its details, or ask the team about a custom scope.' },
      ], [
        ...matched.map((item) => ({ id: `package:${item.slug}`, label: item.title })),
        { id: `lead:${service.title}`, label: 'Ask for a quote' },
        { id: 'main-menu', label: 'Main menu' },
      ]);
    }
    if (matchingPackage) return this.package(matchingPackage.slug);
    const lines = packages.map((item) => `• ${item.title}: ${packagePrice(item)}`);
    return this.turn([
      { text: `Published catalogue prices:\n${lines.join('\n')}` },
      { text: 'Tap a package to see its details and listed billing period.' },
    ], [
      ...packages.slice(0, 8).map((item) => ({ id: `package:${item.slug}`, label: item.title })),
      { id: 'lead', label: 'Get a custom quote' },
      { id: 'services', label: 'Services' },
    ]);
  }

  private package(slug: string): ChatbotTurn {
    const item = this.knowledge.packages?.find((candidate) => candidate.slug === slug && candidate.status === 'published');
    if (!item) return this.pricing();
    this.currentOffer = item.title;
    return this.reply(
      `${item.title}\n${item.summary}\n\nListed price: ${packagePrice(item)}\n\nPackage details are available in the Catalogue.`,
      [
        { id: `lead:${item.title}`, label: 'Ask about this package' },
        { id: 'catalogue', label: 'Cart and enquiry options' },
        { id: 'pricing', label: 'Other prices' },
        { id: 'main-menu', label: 'Main menu' },
      ],
      `/catalogue/${item.slug}`,
    );
  }

  private consultation(): ChatbotTurn {
    const consultationLabel = this.knowledge.siteContent.contactPage.primaryCta || 'Request a consultation';
    const auditLabel = this.knowledge.siteContent.servicesPage.primaryCta || '';
    const configuredDestination = this.knowledge.siteContent.ctaDestinations?.['header.consultation'] || '';
    const destination = isSafePublicDestination(configuredDestination) ? configuredDestination : '/get-started';
    return this.reply(
      `The current website invites businesses to ${consultationLabel.toLowerCase()}${auditLabel ? ` and highlights “${auditLabel}” on its Services page` : ''}. Use the published request form to discuss your goals and the right next step.`,
      [
        { id: 'consultation-link', label: consultationLabel },
        { id: 'lead:Consultation request', label: 'Prepare a WhatsApp enquiry' },
        { id: 'services', label: 'Services' },
        { id: 'main-menu', label: 'Main menu' },
      ],
      destination,
    );
  }

  private contact(): ChatbotTurn {
    if (this.knowledge.availability?.siteContent === 'loading') {
      return this.reply('I’m loading the current published contact details. You can open the Contact page or ask the team to prepare a WhatsApp message.', [
        { id: 'route:/contact', label: 'Open Contact page' },
        { id: 'lead', label: 'Prepare a WhatsApp message' },
        { id: 'main-menu', label: 'Main menu' },
      ]);
    }
    const settings = this.knowledge.siteContent.footerSettings;
    const lines = ['You can reach NearGrow Ads here:'];
    if (settings.phone) lines.push(`Phone: ${settings.phone}`);
    if (settings.email) lines.push(`Email: ${settings.email}`);
    if (settings.location) lines.push(`Location: ${settings.location}`);
    if (settings.hours) lines.push(`Hours: ${settings.hours}`);
    const replies: ChatbotQuickReply[] = [
      { id: 'contact-phone', label: 'Call the team' },
      { id: 'contact-email', label: 'Email the team' },
      { id: 'contact-whatsapp', label: 'WhatsApp the team' },
      { id: 'lead', label: 'Send to team' },
      { id: 'main-menu', label: 'Main menu' },
    ].filter((item) => {
      if (item.id === 'contact-phone') return Boolean(settings.phoneDestination && isSafePublicDestination(settings.phoneDestination));
      if (item.id === 'contact-email') return Boolean(settings.emailDestination && isSafePublicDestination(settings.emailDestination));
      if (item.id === 'contact-whatsapp') return Boolean(safeWhatsappNumber(this.knowledge));
      return true;
    });
    return this.reply(lines.join('\n'), replies, '/contact');
  }

  private contactDestination(kind: 'phone' | 'email' | 'whatsapp'): ChatbotTurn {
    const settings = this.knowledge.siteContent.footerSettings;
    const whatsappNumber = kind === 'whatsapp' ? safeWhatsappNumber(this.knowledge) : undefined;
    const destination = kind === 'phone'
      ? settings.phoneDestination
      : kind === 'email'
        ? settings.emailDestination
        : whatsappNumber
          ? `https://wa.me/${whatsappNumber}`
          : settings.whatsappDestination;
    const label = kind === 'phone' ? 'Call' : kind === 'email' ? 'Email' : 'WhatsApp';
    return destination && isSafePublicDestination(destination)
      ? this.reply(`Open the configured ${label} contact option.`, BASE_MENU, destination)
      : this.reply(`The configured ${label} contact link is unavailable right now.`, BASE_MENU);
  }

  private human(): ChatbotTurn {
    return this.reply('Happy to connect you with our team. I can prepare a WhatsApp message for you to review and send, or show the current contact details.', [
      { id: 'lead', label: 'Leave my details' },
      { id: 'contact', label: 'Contact details' },
      { id: 'services', label: 'Services' },
    ]);
  }

  private website(): ChatbotTurn {
    const service = this.knowledge.services?.find((item) => /website|web development|web design/i.test(`${item.title} ${item.slug}`));
    if (!service) {
      return this.reply('I could not verify current website-development service details. Please check the published Services page or ask our team about your requirements.', [
        { id: 'route-services', label: 'Open Services page' },
        { id: 'lead:Website development enquiry', label: 'Ask the team' },
        { id: 'main-menu', label: 'Main menu' },
      ]);
    }
    return this.reply(`${service.title}\n${service.shortDescription}\n\nThe published service details are available here.`, [
      { id: `lead:${service.title}`, label: 'Ask for a quote' },
      { id: 'services', label: 'Other services' },
      { id: 'main-menu', label: 'Main menu' },
    ], `/services/${service.slug}`);
  }

  private blog(): ChatbotTurn {
    const posts = this.knowledge.blogPosts.filter((post) => post.status === undefined || post.status === 'published').slice(0, 3);
    const text = posts.length
      ? `Our blog shares practical growth guidance. Recent published posts:\n${posts.map((post) => `• ${post.title}`).join('\n')}`
      : 'I could not find published blog posts right now. You can check the Blog page for current articles.';
    return this.reply(text, [
      ...posts.map((post) => ({ id: `blog:${post.slug}`, label: post.title })),
      { id: 'route-blog', label: 'Open Blog' },
      { id: 'main-menu', label: 'Main menu' },
    ], '/blog');
  }

  private blogPost(slug: string): ChatbotTurn {
    const post = this.knowledge.blogPosts.find((item) => item.slug === slug && (item.status === undefined || item.status === 'published'));
    if (!post) return this.blog();
    return this.reply(post.excerpt, [
      { id: 'route-blog-post', label: 'Read article' },
      { id: 'services', label: 'Services' },
      { id: 'main-menu', label: 'Main menu' },
    ], `/blog/${post.slug}`);
  }

  private about(): ChatbotTurn {
    const studies = this.knowledge.caseStudies?.filter((study) => study.status === 'published').slice(0, 3);
    if (!studies) {
      const message = this.knowledge.availability?.caseStudies === 'loading'
        ? 'I’m loading published case-study information. You can browse the Work page in the meantime.'
        : 'Published case-study information is unavailable right now. You can browse the Work page for documented examples.';
      return this.reply(message, [
        { id: 'route-work', label: 'Open Work' },
        { id: 'contact', label: 'Contact details' },
        { id: 'main-menu', label: 'Main menu' },
      ], '/work');
    }
    const content = studies.length
      ? `Here are selected published case studies:\n${studies.map((study) => `• ${study.title} — ${study.category}`).join('\n')}`
      : 'There are no published case studies available right now. You can still explore the Work page or ask our team about our approach.';
    return this.reply(content, [
      ...studies.map((study) => ({ id: `case:${study.slug}`, label: study.title })),
      { id: 'route-work', label: 'Open Work' },
      { id: 'services', label: 'Services' },
    ], '/work');
  }

  private caseStudy(slug: string): ChatbotTurn {
    const study = this.knowledge.caseStudies?.find((item) => item.slug === slug && item.status === 'published');
    if (!study) return this.about();
    return this.reply(
      `${study.title}\n${study.summary || study.challenge}\n\n${study.resultsContext}`,
      [{ id: 'route-work', label: 'Explore case studies' }, { id: 'services', label: 'Services' }],
      '/work',
    );
  }

  private faq(faq?: PublicFaq): ChatbotTurn {
    if (this.knowledge.availability?.siteContent === 'loading') {
      return this.reply('I’m loading the current published FAQs. You can contact our team or explore published services while I check.', [
        { id: 'contact', label: 'Contact details' },
        { id: 'services', label: 'Services' },
        { id: 'main-menu', label: 'Main menu' },
      ]);
    }

    if (!faq) {
      return this.reply('Published FAQ information is unavailable right now. Our team can help answer your question.', [
        { id: 'contact', label: 'Contact details' },
        { id: 'lead', label: 'Send to team' },
        { id: 'main-menu', label: 'Main menu' },
      ]);
    }
    return this.reply(faq.answer, [
      { id: 'consultation', label: 'Consultation' },
      { id: 'pricing', label: 'Pricing' },
      { id: 'lead', label: 'Send to team' },
    ]);
  }

  private faqMenu(): ChatbotTurn {
    if (this.knowledge.availability?.siteContent === 'loading') {
      return this.reply('I’m loading the current published FAQs. Please choose again in a moment, or contact the team.', [
        { id: 'contact', label: 'Contact details' },
        { id: 'main-menu', label: 'Main menu' },
      ]);
    }
    const faqs = this.knowledge.siteContent.faqs;
    if (!faqs.length) {
      return this.reply('There are no published FAQs available right now. You can ask the team directly.', [
        { id: 'contact', label: 'Contact details' },
        { id: 'lead', label: 'Ask the team' },
        { id: 'main-menu', label: 'Main menu' },
      ]);
    }
    return this.turn(
      [{ text: 'Choose a published FAQ and I’ll share its answer.' }],
      [
        ...faqs.map((item) => ({ id: `faq:${item.id}`, label: item.question })),
        { id: 'main-menu', label: 'Main menu' },
      ],
    );
  }

  private startLead(offer = this.currentOffer, question = ''): ChatbotTurn {
    this.handoffUrl = '';
    this.leadFlow = { step: 'consent', status: 'collecting', details: { offer, question } };
    return this.reply(
      'If you agree, the details you provide will be saved to the NearGrow Ads enquiry inbox so the team can respond, as described in the Privacy Policy. You can cancel at any time.',
      [
        { id: 'lead-consent', label: 'Agree and continue' },
        { id: 'cancel', label: 'Cancel' },
      ],
      '/privacy-policy',
    );
  }

  private acceptLeadConsent(): ChatbotTurn {
    if (!this.leadFlow || this.leadFlow.status !== 'collecting' || this.leadFlow.step !== 'consent') return this.respondUnknown('');
    this.leadFlow.step = 'name';
    return this.reply('What is your name?', [{ id: 'cancel', label: 'Cancel' }]);
  }

  private cancelLead(): ChatbotTurn {
    if (this.leadFlow) this.leadFlow.status = 'cancelled';
    return this.reply('No problem, I have cancelled that. Nothing was saved or sent.', BASE_MENU);
  }

  private advanceLead(value: string): ChatbotTurn {
    const flow = this.leadFlow;
    if (!flow || flow.status !== 'collecting') return this.respond(value);
    const input = value.trim().slice(0, 300);
    const normalized = normalize(input);
    if (/^(cancel|stop|exit|quit|menu|main menu|back|never mind|nevermind)$/.test(normalized)) {
      return this.cancelLead();
    }
    if (flow.step === 'consent') {
      if (/^(yes|agree|i agree|continue|okay|ok)$/.test(normalized)) return this.acceptLeadConsent();
      return this.reply('Please choose whether to agree and continue or cancel. No personal details are needed to cancel.', [
        { id: 'lead-consent', label: 'Agree and continue' },
        { id: 'cancel', label: 'Cancel' },
      ]);
    }
    const skip = /^(skip|none|no|na|n a|not now)$/.test(normalized);
    const cancel = [{ id: 'cancel', label: 'Cancel' }];
    const optional = [{ id: 'skip', label: 'Skip' }, ...cancel];
    const details = flow.details;

    if (flow.step === 'name') {
      if (input.length < 2 || !/[a-z]/i.test(input) || /@|\d{4,}/.test(input)) {
        return this.reply('Please enter your name, for example “Ravi Kumar”.', cancel);
      }
      details.name = input.slice(0, 60);
      flow.step = 'phone';
      return this.reply(`Thanks, ${details.name}. What is your phone or WhatsApp number?`, cancel);
    }
    if (flow.step === 'phone') {
      const digits = input.replace(/\D/g, '');
      if (!/^[\d\s+()-]+$/.test(input) || digits.length < 7 || digits.length > 15) {
        return this.reply('That number does not look right. Please enter a valid phone or WhatsApp number (7 to 15 digits).', cancel);
      }
      details.phone = input.slice(0, 20);
      flow.step = 'business';
      return this.reply('What is your business name? You can skip this.', optional);
    }
    if (flow.step === 'business') {
      details.business = skip ? '' : input.slice(0, 100);
      flow.step = 'email';
      return this.reply('Your email address? This is optional.', optional);
    }
    if (!skip && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input)) {
      return this.reply('That email does not look right. Please check it, or tap Skip.', optional);
    }
    details.email = skip ? '' : input.slice(0, 120);
    return this.finishLead(details);
  }

  private finishLead(details: LeadDetails): ChatbotTurn {
    const flow = this.leadFlow;
    if (!flow || flow.status !== 'collecting' || !details.name || !details.phone) {
      return this.reply('I could not prepare that enquiry. Please start a new inquiry to try again.', [
        { id: 'new-inquiry', label: 'Start a new inquiry' },
        { id: 'ask-question', label: 'Ask another question' },
      ]);
    }
    flow.status = 'submitting';
    flow.submissionId ??= globalThis.crypto.randomUUID();
    return this.createLeadSubmissionTurn(flow);
  }

  private retryLeadSubmission(): ChatbotTurn {
    const flow = this.leadFlow;
    if (!flow || flow.status !== 'failed' || !flow.submissionId) {
      return this.reply('There is no failed enquiry to retry. Choose Start a new inquiry if you would like to contact the team.', [
        { id: 'new-inquiry', label: 'Start a new inquiry' },
        { id: 'ask-question', label: 'Ask another question' },
      ]);
    }
    flow.status = 'submitting';
    return this.createLeadSubmissionTurn(flow);
  }

  private createLeadSubmissionTurn(flow: LeadFlow): ChatbotTurn {
    const details = flow.details;
    if (!flow.submissionId || !details.name || !details.phone) {
      flow.status = 'failed';
      return this.reply('I could not prepare that enquiry. Your details are still here. Choose Retry or Cancel.', [
        { id: 'lead-retry', label: 'Retry' },
        { id: 'cancel', label: 'Cancel' },
      ]);
    }
    const context = [
      details.offer ? `Service or offer: ${details.offer}` : 'Service or offer: Not specified',
      details.question ? `Visitor question: ${details.question}` : '',
    ].filter(Boolean).join('\n');
    return {
      messages: [],
      quickReplies: [],
      leadSubmission: {
        submissionId: flow.submissionId,
        name: details.name,
        phone: details.phone,
        businessName: details.business || '',
        email: details.email || '',
        serviceInterest: (details.offer || 'General enquiry').slice(0, 100),
        message: `Enquiry submitted through the NEO Chatbot.\n${context}`.slice(0, 2000),
      },
    };
  }

  private respondUnknown(input: string): ChatbotTurn {
    const question = input.trim().slice(0, 300);
    this.missCount += 1;
    const messages = [
      'I can help you explore our services, published pricing, business consultation, or contact details. What would you like to do?',
      'I may not have those details yet. I can pass your question to the team, or you can choose a topic below.',
      'Our team can answer that best. Would you like to send an enquiry to the team?',
    ];
    const replies: ChatbotQuickReply[] = [
      { id: 'services', label: 'Services' },
      { id: 'pricing', label: 'Pricing' },
      { id: 'consultation', label: 'Consultation' },
      { id: 'contact', label: 'Contact details' },
      { id: `lead-question:${question}`, label: this.missCount > 1 ? 'Send my question to the team' : 'Start an inquiry' },
    ];
    return this.reply(messages[Math.min(this.missCount - 1, messages.length - 1)], replies);
  }

  private respond(input: string): ChatbotTurn {
    const previousMiss = this.missCount;
    this.missCount = 0;
    const normalized = normalize(input);
    const tokens = normalized.split(' ').filter(Boolean);
    const hits = (keywords: string[]) => keywordHits(input, keywords);
    const matchService = this.knowledge.services?.filter((service) => service.status === 'published').map((service) => ({
      service,
      score: keywordHits(input, [service.title, service.slug.replace(/-/g, ' '), service.badge, ...service.deliverables.slice(0, 5)]),
    })).sort((left, right) => right.score - left.score)[0];
    const matchPackage = this.knowledge.packages?.filter((item) => item.status === 'published').map((item) => ({
      item,
      score: keywordHits(input, [item.title, item.slug.replace(/-/g, ' '), item.category]),
    })).sort((left, right) => right.score - left.score)[0];
    const pricingHit = hits(['price*', 'pricing', 'cost*', 'how much', 'charge*', 'fee*', 'rate*', 'plan*', 'package*', 'budget', 'affordable', 'discount*', 'coupon', 'payment']);

    if (!normalized) return this.respondUnknown(input);
    if (tokens.length <= 4 && hits(['hi', 'hello', 'hey', 'hii', 'namaste', 'good morning', 'good afternoon', 'good evening'])) {
      return this.reply('Hi! How can I help you today?', BASE_MENU);
    }
    if (tokens.length <= 5 && hits(['thanks', 'thank you', 'thankyou', 'thx', 'great', 'awesome', 'perfect'])) {
      return this.reply("You're welcome! Is there anything else I can help with?", BASE_MENU);
    }
    if (tokens.length <= 3 && hits(['bye', 'goodbye', 'see you'])) {
      return this.reply("Thanks for stopping by! I'm here whenever you need help.", BASE_MENU);
    }
    if (tokens.length <= 2 && hits(['yes', 'yeah', 'yep', 'ok', 'okay', 'sure'])) {
      return this.reply('What would you like to explore?', BASE_MENU);
    }
    if (hits(['human', 'person', 'agent', 'representative', 'someone', 'real person', 'talk to', 'speak to', 'call me', 'callback', 'get in touch', 'expert', 'advisor']) ||
      (hits(['team']) && !(matchService?.score))) return this.human();
    const explicitLeadRequest = hits([
      'get a quote', 'want a quote', 'need a quote', 'request a quote', 'quote for',
      'send an enquiry', 'send an inquiry', 'submit an enquiry', 'submit an inquiry',
      'start an enquiry', 'start an inquiry', 'send to team', 'leave my details',
    ]) || /^(quote|quotation|enquiry|inquiry)$/.test(normalized);
    if (explicitLeadRequest &&
      !pricingHit && !hits(['audit'])) {
      return this.startLead(matchService?.score ? matchService.service.title : '', input);
    }
    if (hits(['phone', 'number', 'email', 'mail', 'address', 'whatsapp', 'location', 'office', 'timing', 'timings', 'hours', 'open', 'reach', 'contact', 'where'])) {
      return this.contact();
    }
    if (hits(['audit', 'analysis', 'analyse', 'analyze', 'health check', 'insights', 'report', 'free audit'])) {
      return this.consultation();
    }
    if (hits(['consultation', 'book a call', 'discovery call'])) return this.consultation();
    if (pricingHit) return this.pricing(
      matchService?.score ? matchService.service : undefined,
      matchPackage?.score ? matchPackage.item : undefined,
    );
    if (matchPackage?.score) return this.package(matchPackage.item.slug);
    if (matchService?.score) return this.service(matchService.service.slug);
    if (hits(['website', 'web site', 'web design', 'web development', 'landing page', 'wordpress', 'ecommerce', 'online store', 'web'])) {
      return this.website();
    }
    if (hits(['shop', 'buy', 'purchase', 'bag', 'cart', 'checkout', 'order*', 'catalogue', 'catalog'])) {
      return this.reply('Open the Catalogue to add published packages to its cart, submit an enquiry, or review the current checkout options. This chat does not add items to the cart.', [
        { id: 'route-catalogue', label: 'Open Catalogue' },
        { id: 'pricing', label: 'Pricing' },
        { id: 'services', label: 'Services' },
      ], '/catalogue');
    }
    if (hits(['blog*', 'article*', 'tips', 'guide', 'learn'])) return this.blog();
    if (hits(['testimonial*', 'client*', 'case study', 'results', 'trust*', 'experience', 'who are you', 'about you', 'about neargrow', 'proof'])) {
      return this.about();
    }
    if (hits(['service*', 'offer*', 'what do you do', 'what can you do', 'help with', 'provide', 'solutions'])) {
      return this.services();
    }

    const faq = this.knowledge.siteContent.faqs
      .map((item) => ({
        item,
        score: keywordHits(input, [
          ...normalize(item.question).split(' ').filter((word) => word.length > 2),
          ...normalize(item.answer).split(' ').filter((word) => word.length > 4),
        ]),
      }))
      .sort((left, right) => right.score - left.score)[0];
    if (faq && faq.score >= 2) return this.faq(faq.item);
    this.missCount = previousMiss;
    return this.respondUnknown(input);
  }
}
