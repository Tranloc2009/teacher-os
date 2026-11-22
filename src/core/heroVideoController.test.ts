import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HERO_SHOWCASE_MEDIA,
  describeHeroVideoError,
  diagnoseHeroVideoProbeResponse,
  resolveHeroVideoPlaybackIntent,
  resolveNextUserOverride,
  shouldKeepPosterUnderlay,
  shouldShowManualPlayOverlay,
  type HeroVideoPlaybackContext,
} from './heroVideoController';

const baseVisibleContext: HeroVideoPlaybackContext = {
  prefersReducedMotion: false,
  isDocumentVisible: true,
  isViewActive: true,
  isInViewport: true,
  userOverride: null,
  hasError: false,
};

test('autoplays by default when visible, active, in viewport, and motion is allowed', () => {
  assert.equal(resolveHeroVideoPlaybackIntent(baseVisibleContext), 'play');
});

test('does NOT autoplay when prefers-reduced-motion is enabled', () => {
  assert.equal(
    resolveHeroVideoPlaybackIntent({
      ...baseVisibleContext,
      prefersReducedMotion: true,
    }),
    'pause'
  );
});

test('allows explicit manual play even when prefers-reduced-motion is enabled', () => {
  assert.equal(
    resolveHeroVideoPlaybackIntent({
      ...baseVisibleContext,
      prefersReducedMotion: true,
      userOverride: 'play',
    }),
    'play'
  );
});

test('respects explicit manual pause even when visible and motion is allowed', () => {
  assert.equal(
    resolveHeroVideoPlaybackIntent({
      ...baseVisibleContext,
      userOverride: 'pause',
    }),
    'pause'
  );
});

test('auto-pauses whenever tab is hidden, another TeacherOS view is open, scrolled offscreen, or errored', () => {
  assert.equal(
    resolveHeroVideoPlaybackIntent({
      ...baseVisibleContext,
      userOverride: 'play',
      isDocumentVisible: false,
    }),
    'pause'
  );

  assert.equal(
    resolveHeroVideoPlaybackIntent({
      ...baseVisibleContext,
      userOverride: 'play',
      isViewActive: false,
    }),
    'pause'
  );

  assert.equal(
    resolveHeroVideoPlaybackIntent({
      ...baseVisibleContext,
      userOverride: 'play',
      isInViewport: false,
    }),
    'pause'
  );

  assert.equal(
    resolveHeroVideoPlaybackIntent({
      ...baseVisibleContext,
      userOverride: 'play',
      hasError: true,
    }),
    'pause'
  );
});

test('resolveNextUserOverride flips current playback state cleanly', () => {
  assert.equal(resolveNextUserOverride(true), 'pause');
  assert.equal(resolveNextUserOverride(false), 'play');
});

test('shows manual play overlay when autoplay is blocked on mobile or reduced motion is active', () => {
  assert.equal(
    shouldShowManualPlayOverlay({
      hasError: false,
      isPlaying: false,
      prefersReducedMotion: false,
      autoplayBlocked: true,
    }),
    true
  );

  assert.equal(
    shouldShowManualPlayOverlay({
      hasError: false,
      isPlaying: false,
      prefersReducedMotion: true,
      autoplayBlocked: false,
    }),
    true
  );

  assert.equal(
    shouldShowManualPlayOverlay({
      hasError: false,
      isPlaying: true,
      prefersReducedMotion: false,
      autoplayBlocked: true,
    }),
    false
  );

  assert.equal(
    shouldShowManualPlayOverlay({
      hasError: true,
      isPlaying: false,
      prefersReducedMotion: false,
      autoplayBlocked: true,
    }),
    false
  );
});

test('keeps poster underlay visible until first visual video frame is decoded or whenever errored', () => {
  assert.equal(shouldKeepPosterUnderlay(false, false), true);
  assert.equal(shouldKeepPosterUnderlay(true, false), false);
  assert.equal(shouldKeepPosterUnderlay(true, true), true);
});

test('maps MediaError codes and stall timeouts to specific Vietnamese user messages', () => {
  assert.match(describeHeroVideoError(1), /gián đoạn/i);
  assert.match(describeHeroVideoError(2), /mạng/i);
  assert.match(describeHeroVideoError(3), /giải mã/i);
  assert.match(describeHeroVideoError(4), /MP4/i);
  assert.match(describeHeroVideoError(null, 'timeout'), /quá lâu/i);
  assert.match(describeHeroVideoError(null, 'play-failed'), /tự phát/i);
});

test('media constants point directly to the MP4 and poster under /media/', () => {
  assert.equal(
    HERO_SHOWCASE_MEDIA.primaryMp4,
    '/media/teacheros-intro.mp4'
  );
  assert.equal(
    HERO_SHOWCASE_MEDIA.posterImage,
    '/media/teacheros-intro-poster.jpg'
  );
  assert.equal(HERO_SHOWCASE_MEDIA.mimeType, 'video/mp4');
});

test('video probe distinguishes HTTP errors, HTML fallback and incorrect MIME from valid MP4', () => {
  assert.equal(diagnoseHeroVideoProbeResponse({ status: 200, contentType: 'video/mp4' }), null);
  assert.equal(diagnoseHeroVideoProbeResponse({ status: 206, contentType: 'VIDEO/MP4; charset=binary' }), null);
  assert.match(diagnoseHeroVideoProbeResponse({ status: 404, contentType: 'text/html' })!, /HTTP 404/);
  assert.match(diagnoseHeroVideoProbeResponse({ status: 200, contentType: 'text/html; charset=utf-8' })!, /HTML/);
  assert.match(diagnoseHeroVideoProbeResponse({ status: 200, contentType: null })!, /MIME/);
  assert.match(diagnoseHeroVideoProbeResponse({ status: 200, contentType: 'application/octet-stream' })!, /MIME/);
});
