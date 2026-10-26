import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type FocusEvent, type PointerEvent, type UIEvent } from 'react';
import { ChevronDown, ExternalLink, Globe } from 'lucide-react';
import { TEAM_SEED, fetchTeam, initials, socialKind, sortTeam, type TeamMember } from '../../data/teamData';
import { normalizeTeamUrl } from '../../data/teamLinks';

/* ---------- small primitives ---------- */

const LinkedInGlyph = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
  </svg>
);

/** Photo with graceful fallback to a branded initials tile (no image set, or image fails to load). */
function Avatar({ member, className, ratio, initialsClass = 'text-[clamp(1.5rem,6vw,2.75rem)]' }: { member: TeamMember; className?: string; ratio: { w: number; h: number }; initialsClass?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [member.imageUrl]);

  if (member.imageUrl && !failed) {
    return (
      <img
        src={member.imageUrl}
        alt={`Portrait of ${member.name}`}
        width={ratio.w}
        height={ratio.h}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`object-cover ${className ?? ''}`}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={`${member.name} (photo coming soon)`}
      className={`flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(103,216,183,0.28),transparent_60%),linear-gradient(160deg,#16222F,#0C141D)] font-extrabold tracking-tight text-[#67D8B7]/90 ${className ?? ''}`}
    >
      <span aria-hidden="true" className={initialsClass}>{initials(member.name)}</span>
    </div>
  );
}

function SocialLink({ member, variant, tabIndex }: { member: TeamMember; variant: 'icon' | 'pill'; tabIndex?: number }) {
  const kind = socialKind(member.socialUrl);
  const href = normalizeTeamUrl(member.socialUrl);
  if (kind === 'none' || !href) return null;
  const label = kind === 'linkedin' ? 'LinkedIn' : 'Portfolio';
  const Icon = kind === 'linkedin' ? LinkedInGlyph : Globe;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={tabIndex}
      aria-label={`${member.name} on ${label} (opens in a new tab)`}
      className={
        variant === 'icon'
          ? 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-[#67D8B7]/50 hover:bg-[#67D8B7]/10 hover:text-[#67D8B7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]'
          : 'inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75 transition hover:border-[#67D8B7]/50 hover:bg-[#67D8B7]/10 hover:text-[#67D8B7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]'
      }
    >
      <Icon className="h-4 w-4" />
      {variant === 'pill' && <span>{label}</span>}
    </a>
  );
}

function MentorSocialLink({ member, active }: { member: TeamMember; active: boolean }) {
  const kind = socialKind(member.socialUrl);
  const href = normalizeTeamUrl(member.socialUrl);
  if (kind === 'none' || !href) return null;
  const isLinkedIn = kind === 'linkedin';
  const Icon = isLinkedIn ? LinkedInGlyph : ExternalLink;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={active ? 0 : -1}
      aria-label={isLinkedIn ? `Open ${member.name}'s LinkedIn profile` : `Open ${member.name}'s portfolio website`}
      className="ng-mentor-social-link inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/75 transition hover:border-[#67D8B7]/50 hover:bg-[#67D8B7]/10 hover:text-[#67D8B7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
    >
      <Icon className="h-4 w-4" />
    </a>
  );
}

/** Pointer-tracked glow origin for the glass cards (pure CSS vars, no re-render). */
const trackGlow = (event: PointerEvent<HTMLElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
};

/* ---------- cards ---------- */

function MentorCard({ member, active }: { member: TeamMember; active: boolean }) {
  return (
    <div className="ng-team-card flex h-full flex-col" onPointerMove={trackGlow}>
      <div className="relative aspect-[4/5] w-full overflow-hidden">
        <Avatar member={member} ratio={{ w: 480, h: 600 }} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0A111A] via-transparent to-transparent" />
        {member.tag && (
          <span className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-full border border-[#67D8B7]/30 bg-[#0A111A]/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#67D8B7] backdrop-blur">
            {member.tag}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="ng-mentor-card-title flex items-start justify-between gap-2">
          <h4 className="min-w-0 flex-1 text-base font-bold leading-snug text-white [overflow-wrap:anywhere]">{member.name}</h4>
          <MentorSocialLink member={member} active={active} />
        </div>
        <p className="text-xs font-semibold leading-snug text-[#8FE1A0]">{member.role}</p>
        <p className="line-clamp-3 text-xs leading-relaxed text-white/60">{member.bio}</p>
      </div>
    </div>
  );
}

const mentorDetails: Record<string, { vision: string; insight: string }> = {
  'mentor-01': {
    vision: 'Make cross-border growth more intentional by pairing the right channels with messaging that feels local.',
    insight: 'A strong expansion plan starts with understanding the audience in each market.',
  },
  'mentor-02': {
    vision: 'Help growing teams build dependable technical foundations that support secure, sustainable delivery.',
    insight: 'Reliable architecture gives ambitious teams room to scale with confidence.',
  },
  'mentor-03': {
    vision: 'Turn search and measurement into a clearer view of performance across regions and languages.',
    insight: 'Useful measurement connects what audiences search for with the decisions teams make next.',
  },
  'mentor-04': {
    vision: 'Help brands move into new markets with focused go-to-market plans and purposeful partnerships.',
    insight: 'The best next market is the one where a clear opportunity meets a practical route to reach it.',
  },
};

function CoreAccordionCard({
  member,
  index,
  active,
  onActivate,
}: {
  member: TeamMember;
  index: number;
  active: boolean;
  onActivate: (id: string) => void;
}) {
  const detailsId = `core-member-details-${member.id}`;

  return (
    <li
      className={`ng-core-accordion-item${active ? ' is-active' : ''}`}
      data-active={active}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') onActivate(member.id);
      }}
      onPointerMove={trackGlow}
    >
      <article className="ng-core-accordion-card">
        <button
          type="button"
          className="ng-core-accordion-trigger"
          aria-expanded={active}
          aria-controls={detailsId}
          aria-label={`${active ? 'Collapse' : 'Expand'} ${member.name} details`}
          title={member.name}
          onClick={() => onActivate(member.id)}
          onFocus={() => onActivate(member.id)}
        >
          <span className="ng-core-compact" aria-hidden="true">
            <span className="ng-core-compact-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="ng-core-compact-initials">{initials(member.name)}</span>
            <span className="ng-core-compact-name">{member.name}</span>
            <span className="ng-core-compact-role">{member.role}</span>
            <ChevronDown className="ng-core-compact-chevron" />
          </span>
        </button>

        <div id={detailsId} className="ng-core-expanded" aria-hidden={!active}>
          <Avatar
            member={member}
            ratio={{ w: 720, h: 960 }}
            initialsClass="text-5xl"
            className="ng-core-photo"
          />
          <div className="ng-core-copy">
            <span className="ng-core-detail-index">NEARGROW ADS · {String(index + 1).padStart(2, '0')}</span>
            <h4>{member.name}</h4>
            <p className="ng-core-role">{member.role}</p>
            <span className="ng-core-accent-line" aria-hidden="true" />
            <p className="ng-core-bio">{member.bio}</p>
          </div>
          <div className="ng-core-social">
            <SocialLink member={member} variant="icon" tabIndex={active ? undefined : -1} />
          </div>
        </div>
      </article>
    </li>
  );
}

/* ---------- section ---------- */

export function LeadershipTeamSection() {
  const [members, setMembers] = useState<TeamMember[]>(() => sortTeam(TEAM_SEED.filter((m) => m.visible)));
  const [activeCoreId, setActiveCoreId] = useState('');
  const [activeCarouselId, setActiveCarouselId] = useState('');
  const [teamLoaded, setTeamLoaded] = useState(false);
  const [coreEntered, setCoreEntered] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches);
  const [carouselReady, setCarouselReady] = useState(false);
  const [carouselVisible, setCarouselVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [mentorCarouselVisible, setMentorCarouselVisible] = useState(false);
  const [mentorHovered, setMentorHovered] = useState(false);
  const [mentorOrder, setMentorOrder] = useState<string[]>(() => sortTeam(TEAM_SEED.filter((m) => m.visible && m.group === 'mentor')).map((m) => m.id));
  const [flickingMentorId, setFlickingMentorId] = useState<string | null>(null);
  const coreSectionRef = useRef<HTMLDivElement>(null);
  const mentorCarouselRef = useRef<HTMLUListElement>(null);
  const mentorOrderRef = useRef(mentorOrder);
  const cycleMentorsRef = useRef<(direction: 1 | -1) => void>(() => {});
  const coreCarouselContainerRef = useRef<HTMLDivElement>(null);
  const coreCarouselRef = useRef<HTMLUListElement>(null);
  const virtualIndexRef = useRef(1);
  const interactionReasonsRef = useRef(new Set<string>());
  const autoplayTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetchTeam().then((list) => {
      if (!alive) return;
      setMembers(list);
      setTeamLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  const mentors = members.filter((m) => m.group === 'mentor');
  const mentorSignature = mentors.map((member) => member.id).join('|');
  const isMentorStack = !isMobile && !reducedMotion && mentors.length > 1;
  const mentorById = new Map(mentors.map((member) => [member.id, member]));
  const orderedMentors = mentorOrder.map((id) => mentorById.get(id)).filter((member): member is TeamMember => Boolean(member));
  mentors.forEach((member) => {
    if (!mentorOrder.includes(member.id)) orderedMentors.push(member);
  });
  const displayMentors = isMentorStack ? orderedMentors : mentors;
  const activeMentor = displayMentors[0] ?? mentors[0];
  const activeMentorDetails = activeMentor ? mentorDetails[activeMentor.id] : undefined;
  const core = members.filter((m) => m.group === 'core');
  const coreSignature = core.map((member) => member.id).join('|');
  const selectedCoreId = core.some((member) => member.id === activeCoreId) ? activeCoreId : core[0]?.id;
  const selectedCarouselId = core.some((member) => member.id === activeCarouselId) ? activeCarouselId : core[0]?.id;
  const carouselSlides = core.length > 1
    ? [{ member: core[core.length - 1], index: core.length - 1, clone: true }, ...core.map((member, index) => ({ member, index, clone: false })), { member: core[0], index: 0, clone: true }]
    : core.map((member, index) => ({ member, index, clone: false }));

  const centeredScrollLeft = (card: HTMLElement, track: HTMLUListElement) =>
    card.offsetLeft - (track.clientWidth - card.clientWidth) / 2;

  const scrollToVirtualSlide = (index: number, behavior: ScrollBehavior = 'smooth') => {
    const track = coreCarouselRef.current;
    const card = track?.children.item(index) as HTMLElement | null;
    if (!track || !card) return;
    virtualIndexRef.current = index;
    track.scrollTo({
      left: centeredScrollLeft(card, track),
      behavior: reducedMotion ? 'instant' : behavior,
    });
    const memberIndex = index === 0 ? core.length - 1 : index === core.length + 1 ? 0 : index - 1;
    if (core[memberIndex]) setActiveCarouselId(core[memberIndex].id);
  };

  const moveCarousel = (direction: -1 | 1) => {
    if (core.length < 2) return;
    const nextVirtualIndex = virtualIndexRef.current + direction;
    scrollToVirtualSlide(nextVirtualIndex);
  };
  const moveCarouselRef = useRef(moveCarousel);
  moveCarouselRef.current = moveCarousel;

  const pauseForInteraction = (reason: string) => {
    interactionReasonsRef.current.add(reason);
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    if (autoplayTimerRef.current) clearInterval(autoplayTimerRef.current);
    setInteractionPaused(true);
  };

  const resumeAfterInteraction = (reason: string) => {
    interactionReasonsRef.current.delete(reason);
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    const checkForResume = (delay: number) => {
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = undefined;
        const carousel = coreCarouselContainerRef.current;
        const hoverSupported = window.matchMedia('(hover: hover)').matches;
        const stillInteracting = interactionReasonsRef.current.has('touch') ||
          Boolean(carousel?.contains(document.activeElement)) ||
          Boolean(hoverSupported && carousel?.matches(':hover'));
        if (stillInteracting) {
          checkForResume(250);
          return;
        }
        interactionReasonsRef.current.clear();
        setInteractionPaused(false);
      }, delay);
    };
    checkForResume(5000);
  };

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 768px)');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMobile = () => setIsMobile(!desktopQuery.matches);
    const updateMotion = () => setReducedMotion(motionQuery.matches);
    const updateVisibility = () => setDocumentVisible(!document.hidden);
    desktopQuery.addEventListener('change', updateMobile);
    motionQuery.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      desktopQuery.removeEventListener('change', updateMobile);
      motionQuery.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useLayoutEffect(() => {
    const track = coreCarouselRef.current;
    if (!teamLoaded || !isMobile || !track || core.length < 2) {
      setCarouselReady(false);
      return;
    }
    const firstMember = track.children.item(1) as HTMLElement | null;
    if (!firstMember) return;
    track.scrollLeft = centeredScrollLeft(firstMember, track);
    virtualIndexRef.current = 1;
    setActiveCarouselId(core[0].id);
    setCarouselReady(true);
  }, [coreSignature, isMobile, teamLoaded]);

  useEffect(() => {
    const carousel = coreCarouselContainerRef.current;
    if (!isMobile || !carousel) {
      setCarouselVisible(false);
      return;
    }
    if (!('IntersectionObserver' in window)) {
      setCarouselVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setCarouselVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(carousel);
    return () => observer.disconnect();
  }, [isMobile, core.length]);

  useEffect(() => {
    if (autoplayTimerRef.current) clearInterval(autoplayTimerRef.current);
    const canAutoplay = isMobile && carouselReady && carouselVisible && documentVisible &&
      !reducedMotion && !interactionPaused && core.length > 1;
    if (!canAutoplay) return;
    autoplayTimerRef.current = setInterval(() => moveCarouselRef.current(1), 3000);
    return () => {
      if (autoplayTimerRef.current) clearInterval(autoplayTimerRef.current);
      autoplayTimerRef.current = undefined;
    };
  }, [isMobile, carouselReady, carouselVisible, documentVisible, reducedMotion, interactionPaused, coreSignature]);

  useEffect(() => () => {
    if (autoplayTimerRef.current) clearInterval(autoplayTimerRef.current);
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
  }, []);

  const handleCoreCarouselScroll = (event: UIEvent<HTMLUListElement>) => {
    const track = event.currentTarget;
    const center = track.scrollLeft + track.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    Array.from(track.children).forEach((child, index) => {
      const card = child as HTMLElement;
      const distance = Math.abs(card.offsetLeft + card.clientWidth / 2 - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    virtualIndexRef.current = closestIndex;
    const memberIndex = closestIndex === 0 ? core.length - 1 : closestIndex === core.length + 1 ? 0 : closestIndex - 1;
    const nextId = core[memberIndex]?.id;
    if (nextId && nextId !== selectedCarouselId) setActiveCarouselId(nextId);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      const currentVirtualIndex = virtualIndexRef.current;
      const normalizedIndex = currentVirtualIndex === 0
        ? core.length
        : currentVirtualIndex === core.length + 1
          ? 1
          : currentVirtualIndex;
      if (normalizedIndex !== currentVirtualIndex) {
        const card = track.children.item(normalizedIndex) as HTMLElement | null;
        if (card) {
          virtualIndexRef.current = normalizedIndex;
          track.scrollTo({ left: centeredScrollLeft(card, track), behavior: 'instant' });
          setActiveCarouselId(core[normalizedIndex - 1].id);
        }
      }
    }, 700);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') pauseForInteraction('touch');
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') resumeAfterInteraction('touch');
  };

  const handleCarouselBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resumeAfterInteraction('focus');
  };

  const handleCarouselFocus = () => pauseForInteraction('focus');

  const handleCarouselMouseEnter = () => pauseForInteraction('hover');
  const handleCarouselMouseLeave = () => resumeAfterInteraction('hover');

  const handleWheel = () => {
    pauseForInteraction('wheel');
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      wheelTimerRef.current = undefined;
      resumeAfterInteraction('wheel');
    }, 200);
  };

  const handleCarouselKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    pauseForInteraction('keyboard');
    moveCarousel(event.key === 'ArrowRight' ? 1 : -1);
    resumeAfterInteraction('keyboard');
  };

  useEffect(() => {
    const section = coreSectionRef.current;
    if (!section || coreEntered) return;
    if (!('IntersectionObserver' in window)) {
      setCoreEntered(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setCoreEntered(true);
        observer.disconnect();
      },
      { threshold: 0.12 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [coreEntered, core.length]);

  useEffect(() => {
    const nextOrder = mentors.map((member) => member.id);
    setMentorOrder(nextOrder);
  }, [mentorSignature]);

  useEffect(() => {
    mentorOrderRef.current = mentorOrder;
  }, [mentorOrder]);

  const cycleMentors = (direction: 1 | -1) => {
    const current = mentorOrderRef.current;
    if (current.length < 2 || flickingMentorId) return;
    const next = direction === 1
      ? [...current.slice(1), current[0]]
      : [current[current.length - 1], ...current.slice(0, -1)];
    if (direction === 1) setFlickingMentorId(current[0]);
    else setFlickingMentorId(null);
    mentorOrderRef.current = next;
    setMentorOrder(next);
  };
  cycleMentorsRef.current = cycleMentors;

  const handleMentorAnimationEnd = (event: AnimationEvent<HTMLLIElement>, memberId: string) => {
    if (event.animationName === 'ng-mentor-flick-out') {
      setFlickingMentorId((current) => current === memberId ? null : current);
    }
  };

  const handleMentorKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (!isMentorStack || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    cycleMentors(event.key === 'ArrowRight' ? 1 : -1);
  };

  useEffect(() => {
    const stage = mentorCarouselRef.current;
    setMentorHovered(isMentorStack && Boolean(stage?.matches(':hover')));
    if (!isMentorStack) {
      setMentorOrder(mentors.map((member) => member.id));
      mentorOrderRef.current = mentors.map((member) => member.id);
      setFlickingMentorId(null);
    }
  }, [isMentorStack, mentorSignature]);

  useEffect(() => {
    const stage = mentorCarouselRef.current;
    if (!isMentorStack || !stage) {
      setMentorCarouselVisible(false);
      return;
    }
    if (!('IntersectionObserver' in window)) {
      setMentorCarouselVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setMentorCarouselVisible(entry.isIntersecting),
      { threshold: 0.05 },
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, [isMentorStack, mentorSignature]);

  useEffect(() => {
    const stage = mentorCarouselRef.current;
    if (!isMentorStack || !documentVisible || !mentorCarouselVisible || mentorHovered || !stage) return;
    const interval = Number.parseFloat(getComputedStyle(stage).getPropertyValue('--cycle-interval')) || 2800;
    const timer = setInterval(() => cycleMentorsRef.current(1), interval);
    return () => clearInterval(timer);
  }, [documentVisible, isMentorStack, mentorCarouselVisible, mentorHovered, mentorSignature]);

  if (!mentors.length && !core.length) return null;

  return (
    <section aria-labelledby="leadership-title" className="about-leadership-section relative isolate overflow-hidden border-b border-white/10 bg-[#0B1014] py-20 text-white sm:py-24">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_85%_8%,rgba(103,216,183,0.10),transparent_40%),radial-gradient(ellipse_at_8%_92%,rgba(62,162,89,0.09),transparent_42%)]" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="mx-auto mb-14 max-w-3xl text-center">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[#67D8B7]">Leadership &amp; Team</div>
          <h2 id="leadership-title" className="text-balance text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Leadership &amp; Guidance Across Borders
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/60 sm:text-base">
            A collective of industry veterans and hands-on specialists, pairing seasoned strategic guidance with the
            engineers, strategists and designers who deliver your growth programme every day.
          </p>
        </header>

        {mentors.length > 0 && (
          <div className="mb-16">
            <SubHeading eyebrow="Strategic Mentors" title="Experienced voices behind our strategy" />
            <div className="ng-mentor-feature">
              <ul
                ref={mentorCarouselRef}
                className={`ng-mentor-carousel grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 lg:grid-cols-4${isMentorStack ? ' is-stack' : ''}`}
                aria-label="Strategic mentors"
                onKeyDown={isMentorStack ? handleMentorKeyDown : undefined}
                onMouseEnter={isMentorStack ? () => setMentorHovered(true) : undefined}
                onMouseLeave={isMentorStack ? () => setMentorHovered(false) : undefined}
              >
                {displayMentors.map((m, index) => (
                  <li
                    key={m.id}
                    className={`group min-w-0${m.id === flickingMentorId ? ' is-flicking' : ''}`}
                    data-stack-position={isMentorStack ? index : undefined}
                    aria-current={isMentorStack && index === 0 ? 'true' : undefined}
                    tabIndex={isMentorStack ? 0 : undefined}
                    onAnimationEnd={isMentorStack ? (event) => handleMentorAnimationEnd(event, m.id) : undefined}
                  >
                    <MentorCard member={m} active={!isMentorStack || index === 0} />
                  </li>
                ))}
              </ul>
              {activeMentor && (
                <aside className="ng-mentor-details" aria-labelledby="ng-mentor-details-title">
                  <div key={activeMentor.id} className="ng-mentor-details-content">
                    <span className="ng-mentor-details-eyebrow">Mentor profile</span>
                    <span className="ng-mentor-details-tag">{activeMentor.tag || 'Strategic Mentor'}</span>
                    <h3 id="ng-mentor-details-title">{activeMentor.name}</h3>
                    <p className="ng-mentor-details-role">{activeMentor.role}</p>
                    <div className="ng-mentor-details-divider" aria-hidden="true" />
                    <div className="ng-mentor-details-block">
                      <h4>Overview</h4>
                      <p>{activeMentor.bio}</p>
                    </div>
                    <div className="ng-mentor-details-block">
                      <h4>Our vision &amp; purpose</h4>
                      <p>{activeMentorDetails?.vision ?? activeMentor.bio}</p>
                    </div>
                    <blockquote className="ng-mentor-insight">
                      <span>Mentor insight</span>
                      <p>{activeMentorDetails?.insight ?? activeMentor.bio}</p>
                    </blockquote>
                  </div>
                </aside>
              )}
            </div>
          </div>
        )}

        {core.length > 0 && (
          <div ref={coreSectionRef} className="ng-core-section" data-entered={coreEntered}>
            <SubHeading
              eyebrow="Core Team"
              title="The specialists who build your growth"
              className="ng-core-heading mb-6"
            />
            <div
              ref={coreCarouselContainerRef}
              className="ng-core-mobile-carousel"
              role="region"
              aria-label="Core team carousel"
              onFocusCapture={handleCarouselFocus}
              onBlurCapture={handleCarouselBlur}
              onMouseEnter={handleCarouselMouseEnter}
              onMouseLeave={handleCarouselMouseLeave}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            >
              <ul
                ref={coreCarouselRef}
                className="ng-core-carousel-track"
                aria-label="Core team members"
                tabIndex={0}
                onScroll={handleCoreCarouselScroll}
                onKeyDown={handleCarouselKeyDown}
                onWheel={handleWheel}
              >
                {carouselSlides.map(({ member, index, clone }) => {
                  const active = !clone && member.id === selectedCarouselId;
                  return (
                    <li
                      key={`${clone ? 'clone' : 'member'}-${member.id}`}
                      className="ng-core-carousel-slide"
                      aria-hidden={clone || !active}
                    >
                      <article
                        className="ng-core-carousel-card"
                        aria-current={active ? 'true' : undefined}
                        aria-label={`${index + 1} of ${core.length}: ${member.name}, ${member.role}`}
                        aria-roledescription="slide"
                      >
                        <Avatar
                          member={member}
                          ratio={{ w: 720, h: 960 }}
                          initialsClass="text-6xl"
                          className="ng-core-carousel-photo"
                        />
                        <div aria-hidden="true" className="ng-core-carousel-gradient" />
                        <div className="ng-core-carousel-copy">
                          <span className="ng-core-detail-index">NEARGROW ADS · {String(index + 1).padStart(2, '0')}</span>
                          <h4>{member.name}</h4>
                          <p>{member.role}</p>
                        </div>
                        <div className="ng-core-social">
                          <SocialLink member={member} variant="icon" tabIndex={active ? undefined : -1} />
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </div>
            <ul className="ng-core-accordion" aria-label="Core team members">
              {core.map((member, index) => (
                <CoreAccordionCard
                  key={member.id}
                  member={member}
                  index={index}
                  active={member.id === selectedCoreId}
                  onActivate={setActiveCoreId}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function SubHeading({ eyebrow, title, className = 'mb-8' }: { eyebrow: string; title: string; className?: string }) {
  return (
    <div className={className}>
      <h3 className="text-xs font-bold uppercase tracking-wider text-[#67D8B7]">{eyebrow}</h3>
      <p className="mt-1 text-lg font-bold tracking-tight text-white sm:text-xl">{title}</p>
    </div>
  );
}
