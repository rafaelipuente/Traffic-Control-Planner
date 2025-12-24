'use client';

import { useEffect, useRef, useState } from 'react';
import { useSpring, MotionValue } from 'framer-motion';

export interface AnimatedValueProps {
  /** The numeric value to animate to */
  value: number | null | undefined;
  /** Suffix to append (e.g., " ft", " mph") */
  suffix?: string;
  /** Prefix to prepend (e.g., "$") */
  prefix?: string;
  /** Number of decimal places (default: 0) */
  precision?: number;
  /** CSS class for styling */
  className?: string;
  /** Animation duration in seconds (default: 0.8) */
  duration?: number;
  /** Whether animation is enabled (set to false in preview state) */
  animate?: boolean;
}

/**
 * Component that displays the animated number value
 */
function AnimatedDigits({ 
  motionValue, 
  precision,
  initialValue
}: { 
  motionValue: MotionValue<number>; 
  precision: number;
  initialValue: number;
}) {
  const [display, setDisplay] = useState(initialValue.toFixed(precision));
  
  useEffect(() => {
    // Subscribe to value changes
    const unsubscribe = motionValue.on('change', (latest) => {
      setDisplay(latest.toFixed(precision));
    });
    return unsubscribe;
  }, [motionValue, precision]);
  
  return <>{display}</>;
}

/**
 * AnimatedValue - Animates numeric values with count-up effect
 * Respects prefers-reduced-motion automatically
 */
export function AnimatedValue({
  value,
  suffix = '',
  prefix = '',
  precision = 0,
  className,
  duration = 0.8,
  animate = true,
}: AnimatedValueProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const previousValueRef = useRef<number>(0);
  const isFirstRender = useRef(true);

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

  // Handle null/undefined values
  const numericValue = value ?? 0;

  // Determine if we should animate
  const shouldAnimate = animate && !prefersReducedMotion;

  // For first render, don't animate (start at target value)
  // For subsequent renders, animate from previous value
  const fromValue = isFirstRender.current ? numericValue : previousValueRef.current;
  
  // Spring motion value - animate from previous/initial to current
  const springValue = useSpring(fromValue, {
    stiffness: 100,
    damping: 30,
    duration: shouldAnimate && !isFirstRender.current ? duration * 1000 : 0,
  });

  // Update spring and track previous value
  useEffect(() => {
    springValue.set(numericValue);
    
    // After first render, mark as not first render anymore
    if (isFirstRender.current) {
      isFirstRender.current = false;
    }
    
    // Store current value for next animation
    previousValueRef.current = numericValue;
  }, [numericValue, springValue]);

  // If value is null/undefined, show placeholder
  if (value === null || value === undefined) {
    return <span className={className}>—</span>;
  }

  // If reduced motion or animation disabled, render plain text
  if (!shouldAnimate) {
    return (
      <span className={className}>
        {prefix}
        {numericValue.toFixed(precision)}
        {suffix}
      </span>
    );
  }

  return (
    <span className={className}>
      {prefix}
      <AnimatedDigits 
        motionValue={springValue} 
        precision={precision} 
        initialValue={numericValue}
      />
      {suffix}
    </span>
  );
}

export default AnimatedValue;
