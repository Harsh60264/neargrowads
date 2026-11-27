import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Bike, CalendarDays, ShoppingCart, Store, X } from 'lucide-react';
import ownerStorefrontImage from '../../assets/images/local_business_storefront_1792080226091.jpg';
import './wildCardLaunchAnnouncement.css';

const AUTO_SHOW_KEY = 'neargrow-wildcard-launch-seen';
const BUSINESS_PURCHASE_ROUTE = '/partners/localdrop?tab=business#partner-interest';
const PARTNER_REGISTRATION_ROUTE = '/partners/register';

interface WildCardLaunchAnnouncementProps {
  onNavigate: (path: string) => void;
  onModalOpenChange: (open: boolean) => void;
}

export function WildCardLaunchAnnouncement({
  onNavigate,
  onModalOpenChange,
}: WildCardLaunchAnnouncementProps) {
  const [announcementVisible, setAnnouncementVisible] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const openedThisSessionRef = useRef(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const openModalRef = useRef<() => void>(() => undefined);

  const openModal = useCallback(() => {
    openedThisSessionRef.current = true;
    try {
      window.sessionStorage.setItem(AUTO_SHOW_KEY, 'true');
    } catch (error) {
      console.warn('[NearGrow Ads] WildCard launch popup session preference could not be saved.', error);
    }
    setIsOpen(true);
    onModalOpenChange(true);
  }, [onModalOpenChange]);

  openModalRef.current = openModal;

  const closeModal = useCallback(() => {
    setIsOpen(false);
    onModalOpenChange(false);
  }, [onModalOpenChange]);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(AUTO_SHOW_KEY) === 'true') {
        openedThisSessionRef.current = true;
        return;
      }
    } catch (error) {
      console.warn('[NearGrow Ads] WildCard launch popup session preference could not be read.', error);
    }

    const timer = window.setTimeout(() => {
      if (!openedThisSessionRef.current) openModalRef.current();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const root = document.getElementById('root');
    const rootWasInert = root?.hasAttribute('inert') ?? false;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    root?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const getFocusableElements = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => element.getClientRects().length > 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      if (root && !rootWasInert) root.removeAttribute('inert');
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [closeModal, isOpen]);

  const navigateFromModal = (path: string) => {
    closeModal();
    onNavigate(path);
  };

  return (
    <>
      {announcementVisible && (
        <aside className="wildcard-launch-announcement" aria-label="NearGrow WildCard announcement">
          <div className="wildcard-launch-announcement__content">
            <span aria-hidden="true">📣</span>
            <span>Introducing NearGrow WildCard — Trial Run 1 December 2026 |</span>
            <button ref={openButtonRef} type="button" onClick={openModal}>
              Explore Now <ArrowRight aria-hidden="true" size={14} />
            </button>
          </div>
          <button
            type="button"
            className="wildcard-launch-announcement__close"
            aria-label="Dismiss WildCard announcement bar"
            onClick={() => setAnnouncementVisible(false)}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </aside>
      )}

      {isOpen && createPortal(
        <div
          className="wildcard-launch-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            ref={dialogRef}
            className="wildcard-launch-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wildcard-launch-title"
            aria-describedby="wildcard-launch-description"
            tabIndex={-1}
          >
            <div className="wildcard-launch-dialog__close-row">
              <button
                ref={closeButtonRef}
                type="button"
                className="wildcard-launch-dialog__close"
                aria-label="Close NearGrow WildCard announcement"
                onClick={closeModal}
              >
                <X aria-hidden="true" size={22} />
              </button>
            </div>
            <div className="wildcard-launch-dialog__layout">
              <div className="wildcard-launch-dialog__visual">
                <img
                  className="wildcard-launch-dialog__owner-photo"
                  src={ownerStorefrontImage}
                  alt="A local business owner at a neighborhood storefront"
                />
                <img
                  className="wildcard-launch-dialog__partner-photo"
                  src="/media/localdrop/scooter-poster.jpg"
                  alt="A delivery partner with a scooter outside a local business"
                />
                <img
                  className="wildcard-launch-dialog__mobile-photo"
                  src="/media/localdrop/scooter-poster.jpg"
                  alt="A delivery partner with a scooter outside a local business"
                />
                <span className="wildcard-launch-dialog__visual-tag">Local business × delivery network</span>
              </div>

              <div className="wildcard-launch-dialog__content">
                <div className="wildcard-launch-dialog__eyebrow">
                  <span aria-hidden="true" />
                  <span>Introducing our new service</span>
                  <span aria-hidden="true" />
                </div>
                <h1 id="wildcard-launch-title">
                  NearGrow <span>WildCard</span>
                </h1>
                <p className="wildcard-launch-dialog__tagline">Local Connections. Bigger Opportunities.</p>
                <p id="wildcard-launch-description" className="wildcard-launch-dialog__description">
                  Connecting local businesses with a growing network of delivery partners.
                </p>

                <div className="wildcard-launch-dialog__trial">
                  <CalendarDays aria-hidden="true" size={21} />
                  <span>Trial Run Begins — 1 December 2026</span>
                </div>

                <div className="wildcard-launch-dialog__offer-row">
                  <div className="wildcard-launch-dialog__reach">
                    <span className="wildcard-launch-dialog__reach-icon"><Store aria-hidden="true" size={23} /></span>
                    <span>
                      <strong>Reach More Local Customers</strong>
                      <span>Promote your business across your area through our delivery partner network.</span>
                    </span>
                  </div>
                  <div className="wildcard-launch-dialog__package">
                    <span>WildCard Business Package</span>
                    <strong>₹10,000</strong>
                    <span>2,100 WildCards</span>
                  </div>
                </div>

                <div className="wildcard-launch-dialog__actions">
                  <button
                    type="button"
                    className="wildcard-launch-dialog__cta wildcard-launch-dialog__cta--primary"
                    onClick={() => navigateFromModal(BUSINESS_PURCHASE_ROUTE)}
                  >
                    <ShoppingCart aria-hidden="true" size={20} />
                    <span>Buy WildCard for Your Business</span>
                    <ArrowRight aria-hidden="true" size={18} />
                  </button>
                  <button
                    type="button"
                    className="wildcard-launch-dialog__cta wildcard-launch-dialog__cta--secondary"
                    onClick={() => navigateFromModal(PARTNER_REGISTRATION_ROUTE)}
                  >
                    <Bike aria-hidden="true" size={22} />
                    <span>Become a Delivery Partner</span>
                    <ArrowRight aria-hidden="true" size={18} />
                  </button>
                </div>
              </div>
            </div>
            <div className="wildcard-launch-dialog__wave" aria-hidden="true" />
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
