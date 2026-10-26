import { useState } from 'react';

/**
 * Guide section: clicking its header folds/unfolds the steps.
 * The markup and class names are the original ones, so styles.css applies unchanged.
 */
export function GuideBlock({ defaultCollapsed = false, children }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div
      className={`guide-block${collapsed ? ' collapsed' : ''}`}
      onClick={(e) => {
        if (e.target.closest('.guide-block__header')) setCollapsed((c) => !c);
      }}
    >
      {children}
    </div>
  );
}

/** FAQ entry: clicking its question toggles the answer. */
export function FaqItem({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`faq-item${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target.closest('.faq-item__q')) setOpen((o) => !o);
      }}
    >
      {children}
    </div>
  );
}
