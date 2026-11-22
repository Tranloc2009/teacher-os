export type HeroVideoPlaybackIntent = 'play' | 'pause';

export type HeroVideoUserOverride = 'play' | 'pause' | null;

export interface HeroVideoPlaybackContext {
  prefersReducedMotion: boolean;
  isDocumentVisible: boolean;
  isViewActive: boolean;
  isInViewport: boolean;
  userOverride: HeroVideoUserOverride;
  hasError: boolean;
}

export interface HeroVideoOverlayState {
  hasError: boolean;
  isPlaying: boolean;
  prefersReducedMotion: boolean;
  autoplayBlocked: boolean;
}

/**
 * Pure state machine deciding whether the homepage showcase video should be playing.
 *
 * Rules:
 * 1. Never play when errored, when the tab is hidden, when DesktopHome is inactive,
 *    or when the video frame has scrolled out of the viewport.
 * 2. Explicit user Pause always wins until the user presses Play.
 * 3. Explicit user Play overrides prefers-reduced-motion while visible & active.
 * 4. When prefers-reduced-motion is enabled and user has not opted in, stay paused
 *    on the static poster image.
 * 5. Otherwise autoplay (muted, looped) smoothly.
 */
export function resolveHeroVideoPlaybackIntent(
  ctx: HeroVideoPlaybackContext
): HeroVideoPlaybackIntent {
  if (ctx.hasError || !ctx.isDocumentVisible || !ctx.isViewActive || !ctx.isInViewport) {
    return 'pause';
  }

  if (ctx.userOverride === 'pause') {
    return 'pause';
  }

  if (ctx.userOverride === 'play') {
    return 'play';
  }

  if (ctx.prefersReducedMotion) {
    return 'pause';
  }

  return 'play';
}

export function resolveNextUserOverride(isCurrentlyPlaying: boolean): 'play' | 'pause' {
  return isCurrentlyPlaying ? 'pause' : 'play';
}

export function shouldShowManualPlayOverlay(state: HeroVideoOverlayState): boolean {
  return !state.hasError && !state.isPlaying && (state.prefersReducedMotion || state.autoplayBlocked);
}

export function shouldKeepPosterUnderlay(hasVisualFrame: boolean, hasError: boolean): boolean {
  return !hasVisualFrame || hasError;
}

/**
 * Maps HTMLMediaElement MediaError codes or network stall timeouts to specific Vietnamese messages.
 */
export function describeHeroVideoError(
  mediaErrorCode: number | null | undefined,
  reason?: 'timeout' | 'play-failed' | null
): string {
  if (reason === 'timeout') {
    return 'Video tải quá lâu trên kết nối hiện tại. Nhấn "Tải lại video" hoặc kiểm tra đường truyền mạng.';
  }

  switch (mediaErrorCode) {
    case 1:
      return 'Quá trình tải video đã bị gián đoạn. Nhấn "Tải lại video" để phát lại.';
    case 2:
      return 'Không thể tải video do kết nối mạng không ổn định. Kiểm tra mạng rồi nhấn "Tải lại video".';
    case 3:
      return 'Trình duyệt trên thiết bị không giải mã được khung hình video. Nhấn "Tải lại video" để thử lại.';
    case 4:
      return 'Không tìm thấy tệp video hoặc định dạng MP4 (H.264/AAC) không được trình duyệt hỗ trợ.';
    default:
      if (reason === 'play-failed') {
        return 'Trình duyệt trên điện thoại không thể tự phát video. Nhấn nút "Phát video" để xem trực tiếp.';
      }
      return 'Không thể phát video giới thiệu trên thiết bị này. Nhấn "Tải lại video" để thử lại.';
  }
}

/** Diagnose deployment failures without misreporting them as codec errors. */
export function diagnoseHeroVideoProbeResponse(input: {
  status: number;
  contentType: string | null;
}): string | null {
  if (input.status < 200 || input.status >= 300) {
    return `Không thể tải tệp video (HTTP ${input.status}). Vui lòng kiểm tra đường dẫn và cấu hình triển khai.`;
  }
  const mimeType = input.contentType?.split(';', 1)[0].trim().toLowerCase();
  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
    return 'Đường dẫn video đang trả về HTML thay vì MP4. Vui lòng kiểm tra static assets và SPA fallback khi triển khai.';
  }
  if (mimeType !== 'video/mp4') {
    return 'Tệp video không được phục vụ với MIME type video/mp4. Vui lòng kiểm tra cấu hình static assets.';
  }
  return null;
}

export const HERO_SHOWCASE_MEDIA = {
  /** Mobile-compatible MP4: H.264 Main Profile Level 3.1 (yuv420p) + AAC-LC stereo + faststart moov */
  primaryMp4: '/media/teacheros-intro.mp4',
  posterImage: '/media/teacheros-intro-poster.jpg',
  mimeType: 'video/mp4',
} as const;
