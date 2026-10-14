// src/components/VideoPlayer.tsx
"use client";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useState,
  useEffect,
} from "react";
import {
  PlayCircle,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
} from "lucide-react";
import { driveUrlToProxy, extractDriveFileId, getProxyUrl } from "@/lib/mediaUtils";

// ─── Types ────────────────────────────────────────────────────────────────────
interface VideoPlayerProps {
  url: string;
  poster?: string;
  onProgress?: (progress: number) => void;
}

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
}

type VideoSource =
  | { kind: "youtube"; embedUrl: string }
  | { kind: "vimeo"; embedUrl: string }
  | { kind: "native"; src: string };

// ─── URL classifier ───────────────────────────────────────────────────────────
function classifyUrl(url: string): VideoSource {
  if (!url) return { kind: "native", src: "" };

  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    const id = url.includes("v=")
      ? url.split("v=")[1].split("&")[0]
      : url.split("/").pop() ?? "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    return {
      kind: "youtube",
      embedUrl: `https://www.youtube.com/embed/${id}?enablejsapi=1&origin=${origin}`,
    };
  }

  if (url.includes("vimeo.com")) {
    const id = url.split("/").pop() ?? "";
    return {
      kind: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${id}`,
    };
  }

  if (extractDriveFileId(url)) {
    return { kind: "native", src: driveUrlToProxy(url) };
  }

  // GCS object key (relative path) — route through proxy
  // External URLs (http/https) are returned as-is by getProxyUrl
  return { kind: "native", src: getProxyUrl(url) };
}

// ─── Utility: time formatting ────────────────────────────────────────────────
function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ─── Custom player (kind: "native" only) ─────────────────────────────────────
interface NativePlayerProps {
  src: string;
  poster?: string;
  onProgress?: (progress: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

// Detect iOS Safari (no standard Fullscreen API)
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|od|ad)/.test(navigator.userAgent);
}

function isTouch(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

function NativePlayer({ src, poster, onProgress, videoRef }: NativePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const iosDevice = useRef(isIOS());
  const touchDevice = useRef(isTouch());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide controls after inactivity
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
      }
    }, 3000);
  }, [videoRef]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // Fullscreen change listener — handles both standard and webkit
  useEffect(() => {
    const handler = () => {
      const fsEl =
        document.fullscreenElement ||
        // @ts-expect-error webkit prefix
        document.webkitFullscreenElement;
      setFullscreen(!!fsEl);
    };
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.setAttribute("webkit-playsinline", "true");
    }
  }, [videoRef]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch((err) => {
        console.warn("[VideoPlayer] play() failed:", err.message);
      });
    } else {
      v.pause();
    }
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, [videoRef]);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = videoRef.current;
      if (!v) return;
      const val = parseFloat(e.target.value);
      v.volume = val;
      v.muted = val === 0;
      setVolume(val);
      setMuted(val === 0);
    },
    [videoRef]
  );

  // Progress bar: supports both mouse and touch
  const scrubToRatio = useCallback(
    (clientX: number) => {
      const bar = progressRef.current;
      const v = videoRef.current;
      if (!bar || !v || !duration) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      v.currentTime = ratio * duration;
      setCurrentTime(ratio * duration);
    },
    [videoRef, duration]
  );

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      scrubToRatio(e.clientX);
    },
    [scrubToRatio]
  );

  const handleProgressTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.stopPropagation(); // don't bubble to container togglePlay
      setIsDragging(true);
      scrubToRatio(e.touches[0].clientX);
    },
    [scrubToRatio]
  );

  const handleProgressTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.stopPropagation();
      scrubToRatio(e.touches[0].clientX);
    },
    [scrubToRatio]
  );

  const handleProgressTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const v = videoRef.current;
    const el = containerRef.current;
    if (!el || !v) return;

    // iOS Safari: use native video fullscreen
    if (iosDevice.current) {
      // @ts-expect-error webkit-specific
      if (typeof v.webkitEnterFullscreen === "function") {
        // @ts-expect-error webkit-specific
        v.webkitEnterFullscreen();
      }
      return;
    }

    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn("[VideoPlayer] fullscreen error:", err);
    }
  }, [videoRef]);

  const restart = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch((err) => {
      console.warn("[VideoPlayer] restart play() failed:", err.message);
    });
  }, [videoRef]);

  // Tap on container: on touch devices first tap shows controls, second tap toggles play
  const handleContainerTap = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Don't react if click bubbled from controls
      if ((e.target as HTMLElement).closest("[data-controls]")) return;

      if (touchDevice.current) {
        if (!hasInteracted || showControls) {
          // Controls are visible — next tap toggles play
          togglePlay();
        }
        setHasInteracted(true);
        resetHideTimer();
        return;
      }

      togglePlay();
    },
    [togglePlay, hasInteracted, showControls, resetHideTimer]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      // Don't trigger if touching controls
      if ((e.target as HTMLElement).closest("[data-controls]")) return;
      resetHideTimer();
    },
    [resetHideTimer]
  );

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 select-none"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => {
        if (videoRef.current && !videoRef.current.paused) {
          setShowControls(false);
        }
      }}
      onClick={handleContainerTap}
      onTouchStart={handleTouchStart}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full object-contain"
        preload="metadata"
        playsInline
        x-webkit-airplay="allow"
        onContextMenu={(e) => e.preventDefault()}
        onPlay={() => {
          setPlaying(true);
          resetHideTimer();
        }}
        onPause={() => {
          setPlaying(false);
          setShowControls(true);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (!isDragging) setCurrentTime(v.currentTime);
          if (v.duration) {
            if (v.buffered.length > 0) {
              setBuffered(
                (v.buffered.end(v.buffered.length - 1) / v.duration) * 100
              );
            }
            onProgress?.((v.currentTime / v.duration) * 100);
          }
        }}
        onEnded={() => {
          setPlaying(false);
          setShowControls(true);
          onProgress?.(100);
        }}
        onError={(e) => {
          console.error("[VideoPlayer] video error:", e.currentTarget.error?.message);
        }}
      />

      {/* Big play icon overlay — shown when paused */}
      <div
        className={`absolute inset-0 flex items-end justify-end p-6 pointer-events-none transition-opacity duration-300 ${
          !playing ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="bg-black/50 rounded-full p-3 backdrop-blur-sm">
          <Play className="w-8 h-8 text-white fill-white" />
        </div>
      </div>

      {/* Controls overlay */}
      <div
        data-controls
        className={`absolute bottom-0 left-0 right-0 transition-all duration-300 ${
          showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
        }`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {/* Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none rounded-b-2xl" />

        <div className="relative px-4 pb-3 pt-8 space-y-2">
          {/* Progress bar — touch + mouse */}
          <div
            ref={progressRef}
            className="relative h-4 flex items-center cursor-pointer group/progress"
            onClick={handleProgressClick}
            onTouchStart={handleProgressTouchStart}
            onTouchMove={handleProgressTouchMove}
            onTouchEnd={handleProgressTouchEnd}
            role="slider"
            aria-label="Video progress"
            aria-valuenow={Math.round(progressPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="w-full h-1.5 rounded-full bg-white/20 relative">
              {/* Buffered */}
              <div
                className="absolute h-full rounded-full bg-white/30"
                style={{ width: `${buffered}%` }}
              />
              {/* Played */}
              <div
                className="absolute h-full rounded-full bg-indigo-500 transition-[width] duration-100"
                style={{ width: `${progressPercent}%` }}
              />
              {/* Thumb — bigger tap target on touch */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-md opacity-0 group-hover/progress:opacity-100 touch:opacity-100 transition-opacity"
                style={{ left: `calc(${progressPercent}% - 8px)` }}
              />
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <button
              onClick={(e) => { e.stopPropagation(); togglePlay(); }}
              className="text-white hover:text-indigo-300 transition-colors p-1 -m-1 touch-manipulation"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current" />
              )}
            </button>

            {/* Restart */}
            <button
              onClick={(e) => { e.stopPropagation(); restart(); }}
              className="text-white/70 hover:text-white transition-colors p-1 -m-1 touch-manipulation"
              aria-label="Restart"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Volume — hidden on iOS (system controls volume) */}
            {!iosDevice.current && (
              <div className="flex items-center gap-1.5 group/vol">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                  className="text-white/70 hover:text-white transition-colors p-1 -m-1 touch-manipulation"
                  aria-label={muted ? "Unmute" : "Mute"}
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                {/* Volume slider — hidden on touch devices (useless) */}
                {!touchDevice.current && (
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-0 group-hover/vol:w-16 transition-all duration-200 accent-indigo-400 cursor-pointer overflow-hidden"
                    aria-label="Volume"
                  />
                )}
              </div>
            )}

            {/* Time */}
            <span className="text-white/80 text-xs font-mono ml-1 select-none tabular-nums">
              {formatTime(currentTime)}
              <span className="text-white/40 mx-1">/</span>
              {formatTime(duration)}
            </span>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Fullscreen */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              className="text-white/70 hover:text-white transition-colors p-1 -m-1 touch-manipulation"
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── VideoPlayer ──────────────────────────────────────────────────────────────
const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ url, poster, onProgress }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const pendingNativeSeekRef = useRef<(() => void) | null>(null);
    const source = classifyUrl(url);
    const isYouTube = source.kind === "youtube";
    const posterSrc = poster ? getProxyUrl(poster) : undefined;
    const sourceKey = source.kind === "native" ? source.src : source.embedUrl;

    useEffect(() => {
      return () => {
        const video = videoRef.current;
        const pendingNativeSeek = pendingNativeSeekRef.current;
        if (video && pendingNativeSeek) {
          video.removeEventListener("loadedmetadata", pendingNativeSeek);
          pendingNativeSeekRef.current = null;
        }
      };
    }, [sourceKey]);

    const seekTo = useCallback(
      (seconds: number) => {
        if (source.kind === "native" && videoRef.current) {
          const video = videoRef.current;
          const playFromSeek = () => {
            video.play().catch((error: unknown) => {
              console.warn("[VideoPlayer] seekTo play() failed:", error);
            });
          };

          if (pendingNativeSeekRef.current) {
            video.removeEventListener("loadedmetadata", pendingNativeSeekRef.current);
            pendingNativeSeekRef.current = null;
          }

          if (video.readyState >= 1) {
            video.currentTime = seconds;
            playFromSeek();
            return;
          }

          // Intentionally wait for the browser's own media metadata event here:
          // there is no app-level timeout because readiness is fully media-driven.
          const applySeekAfterMetadata = () => {
            video.currentTime = seconds;
            playFromSeek();
            video.removeEventListener("loadedmetadata", applySeekAfterMetadata);
            pendingNativeSeekRef.current = null;
          };

          pendingNativeSeekRef.current = applySeekAfterMetadata;
          video.addEventListener("loadedmetadata", applySeekAfterMetadata);
          return;
        }
        if (isYouTube && iframeRef.current) {
          const win = iframeRef.current.contentWindow;
          win?.postMessage(
            JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] }),
            "*"
          );
          win?.postMessage(
            JSON.stringify({ event: "command", func: "playVideo", args: [] }),
            "*"
          );
          return;
        }
        if (source.kind === "vimeo") {
          console.warn("[VideoPlayer] seekTo is not implemented for Vimeo embeds.");
        }
      },
      [isYouTube, source.kind, sourceKey]
    );

    useImperativeHandle(ref, () => ({ seekTo }), [seekTo]);

    if (!url) {
      return (
        <div className="aspect-video w-full rounded-2xl bg-slate-100 dark:bg-slate-900 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800">
          <PlayCircle className="h-12 w-12 mb-2 opacity-20" />
          <p className="text-sm font-medium">No video source provided</p>
        </div>
      );
    }

    if (source.kind === "native") {
      return (
        <NativePlayer
          src={source.src}
          poster={posterSrc}
          onProgress={onProgress}
          videoRef={videoRef}
        />
      );
    }

    // YouTube / Vimeo: iframe
    return (
      <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black shadow-2xl ring-1 ring-white/10">
        <iframe
          ref={iframeRef}
          src={source.embedUrl}
          className="w-full h-full"
          allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        />
      </div>
    );
  }
);

export default VideoPlayer;
