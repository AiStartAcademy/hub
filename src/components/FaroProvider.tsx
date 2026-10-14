// src/components/FaroProvider.tsx

'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { initializeFaro, getWebInstrumentations, faro } from '@grafana/faro-web-sdk';
import { brand } from '@/config/brand';

// Production builds fall back to the brand's collector (previously baked in by the
// Dockerfile); dev keeps the local Faro collector.
const TELEMETRY_URL =
  process.env.NEXT_PUBLIC_TELEMETRY_URL ||
  (process.env.NODE_ENV === 'production' ? brand.urls.telemetryCollector : 'http://localhost:3100/collect');

export function FaroProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession() || {} ;
  const pathname = usePathname();
  const faroInitialized = useRef(false);

  useEffect(() => {
    // An empty collector URL (no NEXT_PUBLIC_TELEMETRY_URL and no brand collector) disables telemetry.
    if (!TELEMETRY_URL) return;
    if (!faroInitialized.current && typeof window !== 'undefined') {
      initializeFaro({
        url: TELEMETRY_URL,
        app: {
          name: 'lms-frontend',
          version: '1.0.0',
          environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NEXT_PUBLIC_NODE_ENV || 'development',
        },
        // No session property: this SDK version does not support it
        instrumentations: [
          ...getWebInstrumentations({
            captureConsole: false, 
          }),
        ],
      });

      const handleGlobalClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const interactiveElement = target.closest('button, a, [role="button"], input[type="submit"]');
        
        if (interactiveElement) {
          faro.api.pushEvent('ui_click', {
            tag: interactiveElement.tagName.toLowerCase(),
            text: interactiveElement.textContent?.slice(0, 50).trim() || 'No text',
            href: (interactiveElement as HTMLAnchorElement).href || 'none',
            id: interactiveElement.id || 'none',
            // Attach custom data at click time
            screen_resolution: `${window.innerWidth}x${window.innerHeight}`,
            pixel_ratio: window.devicePixelRatio.toString(),
          });
        }
      };

      document.addEventListener('click', handleGlobalClick, { passive: true });
      faroInitialized.current = true;
    }
  }, []);

  useEffect(() => {
    if (faroInitialized.current && status === 'authenticated' && session?.user) {
      faro.api.setUser({
        id: session.user.id,
        email: session.user.email || undefined,
        attributes: {
          role: session.user.role || 'STUDENT',
        },
      });
    }
    
    if (faroInitialized.current && status === 'unauthenticated') {
      faro.api.setUser(undefined);
    }
  }, [session, status]);

  useEffect(() => {
    if (faroInitialized.current && pathname) {
      faro.api.setView({
        name: pathname,
      });
      
      faro.api.pushEvent('page_view', { 
        path: pathname,
        // Attach custom data on page view
        screen_resolution: `${window.innerWidth}x${window.innerHeight}`,
        pixel_ratio: window.devicePixelRatio.toString(),
      });
    }
  }, [pathname]);

  return <>{children}</>;
}