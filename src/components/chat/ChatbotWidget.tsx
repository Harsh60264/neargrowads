import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import neoChatAvatar from '../../assets/images/neo-chat-avatar.png';
import type { BlogPost } from '../../data/blogData';
import type { CaseStudy } from '../../data/caseStudiesData';
import {
  ChatbotConversation,
  type ChatbotLeadSubmission,
  type ChatbotKnowledge,
  type ChatbotMessage,
  type ChatbotQuickReply,
  type ChatbotTurn,
} from '../../data/chatbotConversation';
import type { ServicePackage } from '../../data/serviceCatalogue';
import type { SiteContent } from '../../data/siteContent';
import type { WebsiteService } from '../../data/websiteServices';
import { isSafePublicDestination } from '../../data/publicLinks';
import './ChatbotWidget.css';

interface ChatbotWidgetProps {
  siteContent: SiteContent;
  siteContentLoaded: boolean;
  blogPosts: BlogPost[];
  onNavigate: (path: string) => void;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

interface ChatMessage extends ChatbotMessage {
  id: number;
  sender: 'assistant' | 'visitor';
}

interface AsyncPublicData<T> {
  value?: T;
  status: 'loading' | 'ready' | 'unavailable';
}

const messageDelay = (message: ChatbotMessage, reducedMotion: boolean): number =>
  reducedMotion ? 0 : Math.min(750, 280 + message.text.length * 3);

export function ChatbotWidget({ siteContent, siteContentLoaded, blogPosts, onNavigate, isOpen, onOpen, onClose }: ChatbotWidgetProps) {
  const [services, setServices] = useState<AsyncPublicData<WebsiteService[]>>({ status: 'loading' });
  const [packages, setPackages] = useState<AsyncPublicData<ServicePackage[]>>({ status: 'loading' });
  const [caseStudies, setCaseStudies] = useState<AsyncPublicData<CaseStudy[]>>({ status: 'loading' });
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quickReplies, setQuickReplies] = useState<ChatbotQuickReply[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState<string | undefined>(undefined);
  const widgetRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const engineRef = useRef<ChatbotConversation | null>(null);
  const messageIdRef = useRef(0);
  const generationRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const timerResolveRef = useRef<(() => void) | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const activeLeadSubmissionRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);

  const knowledge: ChatbotKnowledge = {
    siteContent,
    services: services.value,
    packages: packages.value,
    blogPosts: blogPosts.filter((post) => post.status === undefined || post.status === 'published'),
    caseStudies: caseStudies.value,
    whatsappNumber,
    availability: {
      siteContent: siteContentLoaded ? 'ready' : 'loading',
      services: services.status,
      packages: packages.status,
      caseStudies: caseStudies.status,
    },
  };
  if (!engineRef.current) engineRef.current = new ChatbotConversation(knowledge);
  else engineRef.current.updateKnowledge(knowledge);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/services', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Published services are unavailable (${response.status}).`);
        const body = await response.json() as { services?: WebsiteService[] };
        if (!Array.isArray(body.services)) throw new Error('The public services response was invalid.');
        setServices({
          value: body.services.filter((service) => service.status === 'published'),
          status: 'ready',
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('[NearGrow Ads] Chatbot could not load published services.', error);
        setServices({ status: 'unavailable' });
      });

    void fetch('/api/catalogue', { cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Published catalogue is unavailable (${response.status}).`);
        const body = await response.json() as { packages?: ServicePackage[]; whatsappNumber?: string };
        if (!Array.isArray(body.packages)) throw new Error('The public catalogue response was invalid.');
        setPackages({
          value: body.packages.filter((item) => item.status === 'published'),
          status: 'ready',
        });
        if (body.whatsappNumber && /^[0-9]{8,15}$/.test(body.whatsappNumber)) {
          setWhatsappNumber(body.whatsappNumber);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('[NearGrow Ads] Chatbot could not load published package information.', error);
        setPackages({ status: 'unavailable' });
      });

    void fetch('/api/case-studies', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Published case studies are unavailable (${response.status}).`);
        const body = await response.json() as { caseStudies?: CaseStudy[] };
        if (!Array.isArray(body.caseStudies)) throw new Error('The public case studies response was invalid.');
        setCaseStudies({
          value: body.caseStudies.filter((study) => study.status === 'published'),
          status: 'ready',
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('[NearGrow Ads] Chatbot could not load published case studies.', error);
        setCaseStudies({ status: 'unavailable' });
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateViewport = () => {
      if (viewportFrameRef.current !== null) return;
      viewportFrameRef.current = window.requestAnimationFrame(() => {
        viewportFrameRef.current = null;
        const keyboardOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
        const hasKeyboard = viewport.height < window.innerHeight * 0.75 || keyboardOffset > 120;
        setKeyboardOpen(hasKeyboard);
        if (hasKeyboard) {
          widgetRef.current?.style.setProperty('--ng-chat-vv-height', `${viewport.height}px`);
          widgetRef.current?.style.setProperty('--ng-chat-keyboard-offset', `${keyboardOffset}px`);
        }
      });
    };
    updateViewport();
    viewport.addEventListener('resize', updateViewport);
    viewport.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      viewport.removeEventListener('resize', updateViewport);
      viewport.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      if (viewportFrameRef.current !== null) window.cancelAnimationFrame(viewportFrameRef.current);
    };
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerResolveRef.current?.();
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    if (viewportFrameRef.current !== null) window.cancelAnimationFrame(viewportFrameRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!stickToBottomRef.current || !messageListRef.current) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    });
    return () => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    };
  }, [messages, isTyping, quickReplies]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeChat();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const appendMessage = (sender: ChatMessage['sender'], message: ChatbotMessage) => {
    setMessages((current) => [...current, {
      ...message,
      id: ++messageIdRef.current,
      sender,
      ...(message.href && !isSafePublicDestination(message.href) ? { href: undefined } : {}),
    }]);
  };

  const stopQueuedReplies = () => {
    generationRef.current += 1;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    timerResolveRef.current?.();
    timerResolveRef.current = null;
    setIsTyping(false);
    setQuickReplies([]);
    return generationRef.current;
  };

  const waitForReply = (duration: number) => new Promise<void>((resolve) => {
    timerResolveRef.current = resolve;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      timerResolveRef.current = null;
      resolve();
    }, duration);
  });

  const submitLead = async (lead: ChatbotLeadSubmission, generation: number) => {
    if (activeLeadSubmissionRef.current === lead.submissionId) return;
    activeLeadSubmissionRef.current = lead.submissionId;
    const controller = new AbortController();
    const requestTimer = window.setTimeout(() => controller.abort(), 15_000);
    setIsTyping(true);
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: lead.submissionId,
          name: lead.name,
          phone: lead.phone,
          businessName: lead.businessName,
          email: lead.email,
          serviceInterest: lead.serviceInterest,
          message: lead.message,
          consent: true,
          preferredContactMethod: 'phone',
          sourcePage: 'NEO Chatbot',
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        success?: boolean;
        leadId?: string;
        message?: string;
      };
      if (!response.ok) throw new Error(body.message || `The enquiry could not be saved (${response.status}).`);
      if (body.success !== true || body.leadId !== lead.submissionId) {
        throw new Error('The server did not confirm a saved enquiry. Your answers are still available to retry.');
      }
      if (generation !== generationRef.current) return;
      const successTurn = engineRef.current?.leadSubmissionSucceeded(lead.submissionId, body.leadId);
      setIsTyping(false);
      if (successTurn) await enqueueTurn(successTurn, generation);
    } catch (error) {
      if (generation !== generationRef.current) return;
      console.error('[NearGrow Ads] Chatbot lead submission failed.', error);
      const failureTurn = engineRef.current?.leadSubmissionFailed(lead.submissionId);
      setIsTyping(false);
      if (failureTurn) await enqueueTurn(failureTurn, generation);
    } finally {
      window.clearTimeout(requestTimer);
      if (activeLeadSubmissionRef.current === lead.submissionId) {
        activeLeadSubmissionRef.current = null;
      }
    }
  };

  const enqueueTurn = async (turn: ChatbotTurn, generation = stopQueuedReplies()) => {
    setQuickReplies([]);
    if (turn.leadSubmission) {
      await submitLead(turn.leadSubmission, generation);
      return;
    }
    for (const message of turn.messages) {
      if (generation !== generationRef.current) return;
      setIsTyping(true);
      await waitForReply(messageDelay(message, reducedMotion));
      if (generation !== generationRef.current) return;
      setIsTyping(false);
      appendMessage('assistant', message);
    }
    if (generation === generationRef.current) setQuickReplies(turn.quickReplies);
  };

  useEffect(() => {
    if (!isOpen) return;
    const greeting = engineRef.current?.greet();
    if (greeting) void enqueueTurn(greeting);
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
  }, [isOpen]);

  const toggleChat = () => {
    if (isOpen) {
      closeChat();
      return;
    }
    openChat();
  };

  const openChat = () => {
    if (isOpen) return;
    onOpen();
  };

  function closeChat() {
    onClose();
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => launcherRef.current?.focus({ preventScroll: true }), 0);
  }

  const submitText = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isTyping || activeLeadSubmissionRef.current) return;
    const value = input.trim().slice(0, 300);
    if (!value) return;
    const generation = stopQueuedReplies();
    appendMessage('visitor', { text: value });
    setInput('');
    const turn = engineRef.current?.ask(value);
    if (turn) void enqueueTurn(turn, generation);
  };

  const chooseReply = (reply: ChatbotQuickReply) => {
    if (isTyping || activeLeadSubmissionRef.current) return;
    const generation = stopQueuedReplies();
    appendMessage('visitor', { text: reply.label });
    const turn = engineRef.current?.choose(reply.id);
    if (turn) void enqueueTurn(turn, generation);
  };

  const followMessageLink = (href: string) => {
    if (!isSafePublicDestination(href)) return;
    if (href.startsWith('/')) {
      onNavigate(href);
      return;
    }
    if (href.startsWith('#')) {
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      ref={widgetRef}
      className="ng-chat-widget"
      data-keyboard-open={keyboardOpen}
      data-chat-open={isOpen}
      data-mascot-docked={isOpen}
    >
      <button
        ref={launcherRef}
        type="button"
        className="ng-chat-launcher"
        onClick={toggleChat}
        aria-label="Chat with NEO"
        aria-expanded={isOpen}
        aria-controls="ng-chat-panel"
        title={isOpen ? 'Close chat' : 'Chat with NEO'}
      >
        {isOpen ? <X aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
      </button>

      {isOpen && (
        <section
          id="ng-chat-panel"
          className="ng-chat-panel"
          role="dialog"
          aria-labelledby="ng-chat-title"
          aria-describedby="ng-chat-subtitle"
          aria-modal="false"
        >
          <div className="ng-chat-header">
            <span className="ng-chat-avatar" role="img" aria-label="NEO avatar">
              {avatarFailed
                ? <span aria-hidden="true">N</span>
                : <img src={neoChatAvatar} alt="" aria-hidden="true" onError={() => setAvatarFailed(true)} />}
            </span>
            <span className="ng-chat-heading">
              <strong id="ng-chat-title">NEO · NearGrow Ads</strong>
              <small id="ng-chat-subtitle">Services, pricing &amp; support</small>
            </span>
            <button type="button" className="ng-chat-close" onClick={closeChat} aria-label="Close chat">
              <X aria-hidden="true" />
            </button>
          </div>

          <div
            ref={messageListRef}
            className="ng-chat-messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            onScroll={(event) => {
              const element = event.currentTarget;
              stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
            }}
          >
            {messages.map((message) => (
              <div key={message.id} className={`ng-chat-message ng-chat-message-${message.sender}`}>
                <p>{message.text}</p>
                {message.href && isSafePublicDestination(message.href) && (
                  <button type="button" className="ng-chat-message-link" onClick={() => followMessageLink(message.href!)}>
                    {message.href.startsWith('https://wa.me/') ? 'Open WhatsApp' :
                      message.href.startsWith('tel:') ? 'Call the team' :
                        message.href.startsWith('mailto:') ? 'Email the team' :
                          'Open'}
                  </button>
                )}
              </div>
            ))}
            {isTyping && (
              <div className="ng-chat-message ng-chat-message-assistant ng-chat-typing" role="status" aria-label="NEO is typing">
                <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
              </div>
            )}
            {quickReplies.length > 0 && (
              <div className="ng-chat-quick-replies" role="group" aria-label="Quick replies">
                {quickReplies.map((reply) => (
                  <button type="button" key={reply.id} onClick={() => chooseReply(reply)} disabled={isTyping}>
                    {reply.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form className="ng-chat-input-row" onSubmit={submitText}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value.slice(0, 300))}
              placeholder="Type your question…"
              maxLength={300}
              autoComplete="off"
              aria-label="Your message"
            />
            <button type="submit" disabled={!input.trim() || isTyping} aria-label="Send message">
              <span>Send</span>
              <Send aria-hidden="true" />
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
