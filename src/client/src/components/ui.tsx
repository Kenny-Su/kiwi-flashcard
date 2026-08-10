import { useEffect, useId, useRef, type ReactNode } from 'react';

export type IconName =
  | 'add'
  | 'alert'
  | 'arrow-left'
  | 'arrow-right'
  | 'book'
  | 'cards'
  | 'check'
  | 'check-circle'
  | 'close'
  | 'download'
  | 'edit'
  | 'info'
  | 'map'
  | 'quiz'
  | 'reset'
  | 'search'
  | 'shuffle'
  | 'sparkles'
  | 'study'
  | 'trash';

const paths: Record<IconName, ReactNode> = {
  add: <><path d="M12 5v14M5 12h14" /></>,
  alert: <><path d="M10.3 3.8 2.4 18a2 2 0 0 0 1.75 3h15.7a2 2 0 0 0 1.75-3L13.7 3.8a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  'arrow-left': <><path d="m15 18-6-6 6-6" /></>,
  'arrow-right': <><path d="m9 18 6-6-6-6" /></>,
  book: <><path d="M7.5 3H17a2 2 0 0 1 2 2v11.5" /><rect x="3" y="7" width="12.5" height="14" rx="2" /><path d="M6.5 12h5.5M6.5 16h3.5" /></>,
  cards: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  'check-circle': <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 8" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
  edit: <><path d="M14.7 6.3 17.7 9.3" /><path d="M4 20l3.7-.8L19.2 7.7a2.1 2.1 0 0 0-3-3L4.8 16.2Z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  map: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="9" cy="18" r="2.5" /><path d="m8.3 6.5 7.3 1M7.2 8.2l1.1 7.3M16.5 10l-5.8 6" /></>,
  quiz: <><path d="M8.5 9a3.5 3.5 0 1 1 5.7 2.7c-1.3 1-2.2 1.6-2.2 3.3M12 19h.01" /><circle cx="12" cy="12" r="9" /></>,
  reset: <><path d="M4 4v6h6" /><path d="M5.4 16.5A8 8 0 1 0 6 7l-2 3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  shuffle: <><path d="M16 3h5v5M4 20l5.5-5.5M21 16v5h-5M4 4l16.5 16.5M14.5 9.5 20.5 3.5" /></>,
  sparkles: <><path d="m12 3 1.15 3.35L16.5 7.5l-3.35 1.15L12 12l-1.15-3.35L7.5 7.5l3.35-1.15L12 3ZM18.5 13l.75 2.25 2.25.75-2.25.75L18.5 19l-.75-2.25L15.5 16l2.25-.75L18.5 13ZM5.5 12l.75 2.25L8.5 15l-2.25.75L5.5 18l-.75-2.25L2.5 15l2.25-.75L5.5 12Z" /></>,
  study: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6.5 7l.8 14h9.4l.8-14M10 11v6M14 11v6" /></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Spinner({ label = 'Loading', size = 'regular' }: { label?: string; size?: 'regular' | 'small' }) {
  return <span className={`spinner${size === 'small' ? ' spinner--small' : ''}`} role="status" aria-label={label} />;
}

export function Notice({ tone = 'info', children, onClose, action }: { tone?: 'info' | 'error' | 'success'; children: ReactNode; onClose?: () => void; action?: ReactNode }) {
  const icon: IconName = tone === 'error' ? 'alert' : tone === 'success' ? 'check-circle' : 'info';
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} size={20} />
      <div className="notice__content">{children}</div>
      {action && <div className="notice__action">{action}</div>}
      {onClose && (
        <button className="icon-button icon-button--small notice__close" type="button" onClick={onClose} aria-label="Dismiss message">
          <Icon name="close" size={15} />
        </button>
      )}
    </div>
  );
}

export function Modal({ open, title, eyebrow, onClose, children, footer, size = 'medium', className = '' }: { open: boolean; title: string; eyebrow?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'medium' | 'large' | 'study' | 'small'; className?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={`modal modal--${size} ${className}`.trim()}
      aria-labelledby={titleId}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="modal__panel">
        <header className="modal__header">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={`Close ${title}`} title="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </dialog>
  );
}
