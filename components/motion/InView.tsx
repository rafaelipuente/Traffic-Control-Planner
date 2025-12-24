'use client';

import { ReactNode, useRef, useEffect, useState } from 'react';
import {
  motion,
  useInView,
  Variant,
  Transition,
  UseInViewOptions,
} from 'motion/react';

// Preset animation variants
export const inViewVariants = {
  fadeUp: {
    hidden: { opacity: 0, y: 24, filter: 'blur(4px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
  },
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
  slideRight: {
    hidden: { opacity: 0, x: -24 },
    visible: { opacity: 1, x: 0 },
  },
  slideLeft: {
    hidden: { opacity: 0, x: 24 },
    visible: { opacity: 1, x: 0 },
  },
  scale: {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1 },
  },
} as const;

export type InViewVariantKey = keyof typeof inViewVariants;

export interface InViewProps {
  children: ReactNode;
  /** Use a preset variant name or provide custom variants */
  variants?: InViewVariantKey | { hidden: Variant; visible: Variant };
  /** Transition settings */
  transition?: Transition;
  /** useInView options (margin, once, amount, etc.) */
  viewOptions?: UseInViewOptions;
  /** Additional delay in seconds */
  delay?: number;
  /** Custom className */
  className?: string;
  /** Whether to trigger animation only once */
  once?: boolean;
}

/**
 * InView - Scroll-triggered animation wrapper
 * Respects prefers-reduced-motion automatically
 */
export function InView({
  children,
  variants = 'fadeUp',
  transition,
  viewOptions,
  delay = 0,
  className,
  once = true,
}: InViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once, ...viewOptions });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  // Check for prefers-reduced-motion on mount
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Resolve variants (preset name or custom object)
  const resolvedVariants =
    typeof variants === 'string' ? inViewVariants[variants] : variants;

  // If reduced motion is preferred, skip animation
  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  const defaultTransition: Transition = {
    duration: 0.4,
    ease: 'easeOut',
    delay,
  };

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      variants={resolvedVariants}
      transition={transition ?? defaultTransition}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default InView;

