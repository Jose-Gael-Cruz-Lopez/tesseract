// Landing intro: a full-screen video shown to signed-out visitors. It autoplays
// muted (so browsers don't block it), then CROSSFADES to the auth flow when it
// finishes. There is no Skip control, so nothing on screen can rescue a visitor
// whose video never ends — the invariant that a blocked autoplay, a load error
// or a stall never strands anyone is now carried entirely by the code paths
// below, all of which fall through to `onDone`.
//
// The video is a fixed overlay on <body> (not `root`), so `onDone` can render the
// sign-in screen underneath it; the overlay then fades out to reveal it — a smooth
// crossfade, not an abrupt swap.

export function mountLanding(root, { onDone }) {
  root.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'landing';

  const video = document.createElement('video');
  video.className = 'landing-video';
  video.src = '/landing.mp4';
  video.autoplay = true;
  video.muted = true;        // required for unattended autoplay
  video.playsInline = true;  // don't force fullscreen on iOS
  video.preload = 'auto';

  let done = false;
  let watchdog = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (watchdog) clearTimeout(watchdog);
    // Render the sign-in screen underneath the overlay first, then fade the video out
    // to reveal it — a smooth crossfade. Remove the overlay once the fade completes.
    onDone();
    requestAnimationFrame(() => wrap.classList.add('is-leaving'));
    setTimeout(() => wrap.remove(), 700); // matches the .6s CSS opacity transition + buffer
  };

  video.addEventListener('ended', finish);
  video.addEventListener('error', finish); // codec/network failure → go straight to sign-in

  // Watchdog: with no Skip control, a video that stalls mid-play fires neither
  // 'ended' nor 'error', which would leave the visitor staring at a frozen frame
  // with no way forward. Give it its own duration plus a margin, falling back to
  // a fixed cap while the duration is still unknown.
  const FALLBACK_MS = 20000;
  const arm = (ms) => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(finish, ms);
  };
  arm(FALLBACK_MS);
  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(video.duration) && video.duration > 0) arm(video.duration * 1000 + 3000);
  });

  wrap.append(video);
  // Overlay on <body> (not root) so onDone() can render the sign-in screen underneath;
  // the fade-out then reveals it for a crossfade.
  document.body.appendChild(wrap);

  // Explicit play() for Safari, which doesn't always honor the autoplay attribute.
  video.play().catch(() => {
    // Autoplay blocked. Skip used to be the way out of this; without it, holding
    // the first frame would strand the visitor, so go straight to sign-in.
    finish();
  });
}
