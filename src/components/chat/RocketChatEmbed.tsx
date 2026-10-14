'use client';

import { useEffect, useState } from 'react';
import { buildChatEmbedUrl, isTrustedChatOrigin } from '@/lib/chat/embedUrl';

interface RocketChatEmbedProps {
  chatUrl: string;
  authToken: string | null;
  /** Single-group mode: the RC group name to open. Ignored when `path` is set. */
  channelName?: string;
  /** Explicit RC route — pass "/home" to embed the full app with its channel list. */
  path?: string;
}

export const RocketChatEmbed = ({ chatUrl, authToken, channelName, path }: RocketChatEmbedProps) => {
  // Two stages: 1. the iframe HTML loaded, 2. Rocket.Chat actually rendered.
  const [isHtmlLoaded, setIsHtmlLoaded] = useState(false);
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedChatOrigin(chatUrl, event.origin)) return;

      // 'startup' means Rocket.Chat consumed the token and painted its UI.
      if (event.data?.eventName === 'startup' || event.data?.eventName === 'room-opened') {
        setIsRendered(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [chatUrl]);

  // Fallback for browsers that drop the postMessage: reveal anyway after 2s.
  useEffect(() => {
    if (isHtmlLoaded && !isRendered) {
      const fallbackTimer = setTimeout(() => setIsRendered(true), 2000);
      return () => clearTimeout(fallbackTimer);
    }
  }, [isHtmlLoaded, isRendered]);

  const targetUrl = buildChatEmbedUrl({ chatUrl, channelName, path, authToken });

  return (
    <div className="relative w-full h-full bg-slate-50 dark:bg-slate-950 rounded-b-2xl overflow-hidden">

      {/* Placeholder stays up until the app itself has rendered. */}
      {!isRendered && (
        <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-slate-900 z-20">
          <div className="flex flex-col items-center gap-3">
            <span className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full"></span>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Opening secure workspace...</p>
          </div>
        </div>
      )}

      {/* Iframe stays invisible through the login flicker, then fades in. */}
      <iframe
        src={targetUrl}
        onLoad={() => setIsHtmlLoaded(true)}
        title="Rocket.Chat"
        className={`w-full h-full border-none transition-opacity duration-500 ease-in-out ${
          isRendered ? 'opacity-100' : 'opacity-0'
        }`}
        allow="camera; microphone; fullscreen; clipboard-read; clipboard-write; display-capture"
      />
    </div>
  );
};
