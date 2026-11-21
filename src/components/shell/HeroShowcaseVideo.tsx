import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  HERO_SHOWCASE_MEDIA,
  describeHeroVideoError,
  resolveHeroVideoPlaybackIntent,
  resolveNextUserOverride,
  shouldKeepPosterUnderlay,
  shouldShowManualPlayOverlay,
  type HeroVideoUserOverride,
} from '../../core/heroVideoController';

interface HeroShowcaseVideoProps {
  /** Whether DesktopHome is the currently visible workspace view */
  isActive?: boolean;
  className?: string;
}

const BUFFER_INDICATOR_DELAY_MS = 700;
const LOAD_STALL_TIMEOUT_MS = 12000;
const AUTOPLAY_PROBE_MS = 1800;

function getInitialReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getInitialDocumentVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

export function HeroShowcaseVideo({
  isActive = true,
  className = '',
}: HeroShowcaseVideoProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(
    getInitialReducedMotion
  );
  const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(
    getInitialDocumentVisible
  );
  const [isInViewport, setIsInViewport] = useState<boolean>(true);
  const [userOverride, setUserOverride] = useState<HeroVideoUserOverride>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [hasVisualFrame, setHasVisualFrame] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [showBufferingBadge, setShowBufferingBadge] = useState<boolean>(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  const hasError = errorMessage !== null;

  // Listen to OS / browser prefers-reduced-motion changes
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
      if (event.matches) {
        setUserOverride(null);
      }
    };

    setPrefersReducedMotion(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  // Pause automatically when browser tab is hidden
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => {
      setIsDocumentVisible(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Pause automatically when scrolled out of viewport so scrolling stays smooth
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setIsInViewport(entry.isIntersecting);
        }
      },
      { threshold: 0.15 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Enforce real HTML attributes required by Safari iOS & Chrome Android autoplay/inline policies
  // (React sets `.muted` as a JS property after mount, not always the HTML attribute iOS WebKit checks)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.defaultMuted = true;
    video.muted = isMuted;
    if (isMuted) {
      video.setAttribute('muted', '');
    } else {
      video.removeAttribute('muted');
    }
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('x5-playsinline', 'true');
  }, [isMuted, reloadNonce]);

  const playbackIntent = resolveHeroVideoPlaybackIntent({
    prefersReducedMotion,
    isDocumentVisible,
    isViewActive: isActive,
    isInViewport,
    userOverride,
    hasError,
  });

  const attemptAutoplay = useCallback(() => {
    const video = videoRef.current;
    if (!video || hasError || playbackIntent !== 'play' || autoplayBlocked) return;
    if (!video.paused) {
      setAutoplayBlocked(false);
      setIsPlaying(true);
      return;
    }

    // Ensure muted attribute is strictly applied before programmatic autoplay on mobile
    if (isMuted) {
      video.defaultMuted = true;
      video.muted = true;
      video.setAttribute('muted', '');
    }

    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          setAutoplayBlocked(false);
          setIsBuffering(false);
        })
        .catch(() => {
          // iOS Low Power Mode, Android Data Saver, or strict autoplay policy blocked autoplay
          setAutoplayBlocked(true);
          setIsPlaying(false);
          setIsBuffering(false);
        });
    }
  }, [autoplayBlocked, hasError, isMuted, playbackIntent]);

  // Drive HTMLMediaElement play/pause from pure intent resolver
  useEffect(() => {
    const video = videoRef.current;
    if (!video || hasError) return;

    if (playbackIntent === 'play') {
      attemptAutoplay();
    } else if (!video.paused) {
      video.pause();
    }
  }, [attemptAutoplay, playbackIntent, hasError, reloadNonce]);

  // Safety probe: if mobile browser silently prevents autoplay without throwing a Promise rejection,
  // expose the explicit Play button so user can start playback with one tap.
  useEffect(() => {
    if (playbackIntent !== 'play' || isPlaying || hasError || autoplayBlocked) {
      return;
    }

    const timer = window.setTimeout(() => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused && video.readyState >= 2) {
        setAutoplayBlocked(true);
        setIsBuffering(false);
      }
    }, AUTOPLAY_PROBE_MS);

    return () => window.clearTimeout(timer);
  }, [playbackIntent, isPlaying, hasError, autoplayBlocked, reloadNonce]);

  // Avoid flashing spinner on fast loads; only show subtle buffering pill if waiting > 700ms
  useEffect(() => {
    if (!isBuffering || hasError || autoplayBlocked || playbackIntent !== 'play') {
      setShowBufferingBadge(false);
      return;
    }

    const delayTimer = window.setTimeout(() => {
      setShowBufferingBadge(true);
    }, BUFFER_INDICATOR_DELAY_MS);

    return () => window.clearTimeout(delayTimer);
  }, [isBuffering, hasError, autoplayBlocked, playbackIntent]);

  // Infinite-loading guard: if video fails to decode a frame after 12s while trying to play,
  // abort waiting state and display a specific actionable Vietnamese message instead of hanging forever.
  useEffect(() => {
    if (playbackIntent !== 'play' || hasVisualFrame || hasError || autoplayBlocked) {
      return;
    }

    const stallTimer = window.setTimeout(() => {
      const video = videoRef.current;
      if (!video) return;
      if (video.readyState < 2 && video.paused) {
        setIsBuffering(false);
        setShowBufferingBadge(false);
        setErrorMessage(describeHeroVideoError(video.error?.code, 'timeout'));
      }
    }, LOAD_STALL_TIMEOUT_MS);

    return () => window.clearTimeout(stallTimer);
  }, [playbackIntent, hasVisualFrame, hasError, autoplayBlocked, reloadNonce]);

  // Dedicated synchronous Play action inside user gesture stack (for center Play CTA on mobile)
  const handleExplicitPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || hasError) return;

    setUserOverride('play');
    setAutoplayBlocked(false);
    if (video.readyState < 2) {
      setIsBuffering(true);
    }
    video.muted = isMuted;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          setAutoplayBlocked(false);
          setIsBuffering(false);
        })
        .catch(() => {
          if (!video.muted) {
            video.muted = true;
            video.setAttribute('muted', '');
            setIsMuted(true);
            video
              .play()
              .then(() => {
                setAutoplayBlocked(false);
                setIsBuffering(false);
              })
              .catch(() => {
                setAutoplayBlocked(true);
                setIsPlaying(false);
                setIsBuffering(false);
              });
            return;
          }
          setAutoplayBlocked(true);
          setIsPlaying(false);
          setIsBuffering(false);
        });
    }
  }, [hasError, isMuted]);

  // Synchronous play/pause toggle inside user gesture handler
  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || hasError) return;

    const nextOverride = resolveNextUserOverride(!video.paused);
    if (nextOverride === 'play') {
      handleExplicitPlay();
    } else {
      setUserOverride('pause');
      video.pause();
      setIsBuffering(false);
    }
  }, [handleExplicitPlay, hasError]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const nextMuted = !prev;
      const video = videoRef.current;
      if (video) {
        video.muted = nextMuted;
        if (nextMuted) {
          video.setAttribute('muted', '');
        } else {
          video.removeAttribute('muted');
        }
      }
      return nextMuted;
    });
  }, []);

  const handleRetryLoad = useCallback(() => {
    setErrorMessage(null);
    setAutoplayBlocked(false);
    setHasVisualFrame(false);
    setIsBuffering(true);
    setUserOverride('play');
    setReloadNonce((n) => n + 1);
  }, []);

  const showCenterPlayPrompt = shouldShowManualPlayOverlay({
    hasError,
    isPlaying,
    prefersReducedMotion,
    autoplayBlocked,
  });

  const keepPosterVisible = shouldKeepPosterUnderlay(hasVisualFrame, hasError);

  return (
    <div
      ref={containerRef}
      className={`rounded-[20px] border border-white/90 dark:border-slate-700/80 bg-white/75 dark:bg-slate-900/75 p-1.5 backdrop-blur-md shadow-[0_18px_40px_-16px_rgba(99,91,255,0.22),0_4px_12px_-4px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_40px_-16px_rgba(0,0,0,0.65)] ring-1 ring-[#635BFF]/10 dark:ring-indigo-400/15 ${className}`}
    >
      {/* Pure 16:9 unobstructed showcase video viewport (concentric radius 20 - 6 = 14px) */}
      <div
        data-testid="hero-showcase-frame"
        className="relative w-full aspect-video overflow-hidden rounded-[14px] bg-[#ECEFF8] dark:bg-slate-950"
      >
        {/* Video element with direct src so MediaError fires reliably on mobile Safari & Android */}
        {!hasError && (
          <video
            key={reloadNonce}
            ref={videoRef}
            data-testid="hero-showcase-video"
            src={HERO_SHOWCASE_MEDIA.primaryMp4}
            poster={HERO_SHOWCASE_MEDIA.posterImage}
            className="block h-full w-full cursor-pointer object-cover"
            autoPlay={!prefersReducedMotion}
            muted={isMuted}
            loop
            playsInline
            preload="auto"
            disableRemotePlayback
            aria-label="Video giới thiệu TeacherOS 4.0"
            onClick={handleTogglePlay}
            onLoadedMetadata={() => {
              if (playbackIntent === 'play') {
                attemptAutoplay();
              }
            }}
            onLoadedData={() => {
              setHasVisualFrame(true);
              setIsBuffering(false);
            }}
            onCanPlay={() => {
              setHasVisualFrame(true);
              setIsBuffering(false);
              if (playbackIntent === 'play' && videoRef.current?.paused) {
                attemptAutoplay();
              }
            }}
            onPlaying={() => {
              setHasVisualFrame(true);
              setIsPlaying(true);
              setIsBuffering(false);
              setAutoplayBlocked(false);
              setErrorMessage(null);
            }}
            onPlay={() => {
              setIsPlaying(true);
              setAutoplayBlocked(false);
            }}
            onPause={() => {
              setIsPlaying(false);
              setIsBuffering(false);
            }}
            onWaiting={() => {
              if (playbackIntent === 'play') {
                setIsBuffering(true);
              }
            }}
            onTimeUpdate={() => {
              if (!hasVisualFrame && (videoRef.current?.currentTime ?? 0) > 0) {
                setHasVisualFrame(true);
              }
            }}
            onError={(e) => {
              const code = e.currentTarget.error?.code ?? null;
              setIsPlaying(false);
              setIsBuffering(false);
              setShowBufferingBadge(false);
              setErrorMessage(describeHeroVideoError(code));
            }}
          />
        )}

        {/* Poster cover layer: guarantees ZERO black screen while first frame decodes or if errored */}
        <img
          src={HERO_SHOWCASE_MEDIA.posterImage}
          alt="Giới thiệu TeacherOS 4.0 — Không gian làm việc thông minh dành cho giáo viên"
          aria-hidden={!keepPosterVisible}
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            keepPosterVisible ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Subtle non-blocking buffering indicator (only shown if genuinely waiting > 700ms) */}
        {showBufferingBadge && !showCenterPlayPrompt && !hasError && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute bottom-3 left-3 z-20 inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-slate-950/75 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
            <span>Đang tải video...</span>
          </div>
        )}

        {/* Centered manual Play CTA when autoplay is blocked on mobile or prefers-reduced-motion is on */}
        {showCenterPlayPrompt && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/12">
            <button
              type="button"
              data-testid="hero-video-center-play"
              onClick={handleExplicitPlay}
              aria-label="Phát video giới thiệu TeacherOS 4.0"
              className="pointer-events-auto inline-flex min-h-[44px] items-center gap-2.5 rounded-2xl border border-white/40 bg-slate-950/85 px-4 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-md hover:bg-slate-950 active:scale-[0.98] transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#172033]">
                <Play
                  className="h-3.5 w-3.5 translate-x-[1px] fill-current"
                  aria-hidden="true"
                />
              </span>
              <span>Xem video giới thiệu</span>
            </button>
          </div>
        )}

        {/* Specific actionable error overlay (poster stays visible behind, never a black screen) */}
        {hasError && (
          <div
            role="alert"
            data-testid="hero-video-error"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-slate-950/60 p-4 text-center backdrop-blur-[2px]"
          >
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
              <span>Không thể phát video</span>
            </div>
            <p className="max-w-sm text-xs sm:text-[13px] leading-relaxed text-white/95">
              {errorMessage}
            </p>
          </div>
        )}
      </div>

      {/* Integrated Aurora Bento media control bar (zero video caption occlusion on desktop & mobile) */}
      <div className="flex items-center justify-end sm:justify-between gap-2 px-1.5 sm:px-2 pt-2 pb-1">
        <div className="hidden sm:block min-w-0">
          <span className="block truncate text-xs font-medium text-[#475569] dark:text-slate-300">
            Giới thiệu TeacherOS 4.0
          </span>
        </div>

        <div
          role="group"
          aria-label="Điều khiển video giới thiệu TeacherOS 4.0"
          className="flex w-full sm:w-auto items-center justify-end gap-1.5 shrink-0"
        >
          {hasError ? (
            <button
              type="button"
              data-testid="hero-video-retry"
              onClick={handleRetryLoad}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-xs font-semibold text-[#172033] dark:text-slate-100 shadow-[0_1px_2px_rgba(23,32,51,0.04)] hover:border-[#635BFF]/40 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#635BFF]"
            >
              <RotateCcw
                className="h-3.5 w-3.5 shrink-0 text-[#635BFF] dark:text-indigo-400"
                aria-hidden="true"
              />
              <span>Tải lại video</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                data-testid="hero-video-play-toggle"
                onClick={handleTogglePlay}
                aria-label={isPlaying ? 'Tạm dừng video giới thiệu' : 'Phát video giới thiệu'}
                aria-pressed={isPlaying}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-800/90 px-3 text-xs font-semibold text-[#172033] dark:text-slate-100 shadow-[0_1px_2px_rgba(23,32,51,0.04)] hover:border-[#635BFF]/45 hover:text-[#5046E5] dark:hover:border-indigo-400/50 dark:hover:text-indigo-300 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#635BFF]"
              >
                {isPlaying ? (
                  <>
                    <Pause
                      className="h-3.5 w-3.5 shrink-0 text-[#635BFF] dark:text-indigo-400"
                      aria-hidden="true"
                    />
                    <span>Tạm dừng</span>
                  </>
                ) : (
                  <>
                    <Play
                      className="h-3.5 w-3.5 shrink-0 fill-current text-[#635BFF] dark:text-indigo-400"
                      aria-hidden="true"
                    />
                    <span>Phát</span>
                  </>
                )}
              </button>

              <button
                type="button"
                data-testid="hero-video-mute-toggle"
                onClick={handleToggleMute}
                aria-label={
                  isMuted ? 'Bật âm thanh video giới thiệu' : 'Tắt âm thanh video giới thiệu'
                }
                aria-pressed={!isMuted}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-800/90 px-3 text-xs font-semibold text-[#172033] dark:text-slate-100 shadow-[0_1px_2px_rgba(23,32,51,0.04)] hover:border-[#635BFF]/45 hover:text-[#5046E5] dark:hover:border-indigo-400/50 dark:hover:text-indigo-300 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#635BFF]"
              >
                {isMuted ? (
                  <>
                    <VolumeX
                      className="h-3.5 w-3.5 shrink-0 text-[#64748B] dark:text-slate-400"
                      aria-hidden="true"
                    />
                    <span>Bật tiếng</span>
                  </>
                ) : (
                  <>
                    <Volume2
                      className="h-3.5 w-3.5 shrink-0 text-[#635BFF] dark:text-indigo-400"
                      aria-hidden="true"
                    />
                    <span>Tắt tiếng</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
