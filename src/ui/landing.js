// Landing intro: a full-screen video shown to signed-out visitors. It autoplays
// muted (so browsers don't block it), then CROSSFADES to the auth flow when it
// finishes — or immediately when the visitor clicks Skip. A blocked autoplay or a
// load error never strands the visitor: both fall through to `onDone`.
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
  const finish = () => {
    if (done) return;
    done = true;
    // Render the sign-in screen underneath the overlay first, then fade the video out
    // to reveal it — a smooth crossfade. Remove the overlay once the fade completes.
    onDone();
    requestAnimationFrame(() => wrap.classList.add('is-leaving'));
    setTimeout(() => wrap.remove(), 700); // matches the .6s CSS opacity transition + buffer
  };

  video.addEventListener('ended', finish);
  video.addEventListener('error', finish); // codec/network failure → go straight to sign-in

  // Tap the video to toggle sound (the click satisfies the gesture requirement).
  const sound = document.createElement('button');
  sound.className = 'landing-sound';
  sound.type = 'button';
  sound.setAttribute('aria-label', 'Unmute');
  sound.textContent = '🔇';
  sound.addEventListener('click', () => {
    video.muted = !video.muted;
    sound.textContent = video.muted ? '🔇' : '🔊';
    if (!video.muted) video.play().catch(() => {});
  });

  const skip = document.createElement('button');
  skip.className = 'landing-skip';
  skip.type = 'button';
  skip.textContent = 'Skip';
  skip.addEventListener('click', finish);

  wrap.append(video, sound, skip);
  // Overlay on <body> (not root) so onDone() can render the sign-in screen underneath;
  // the fade-out then reveals it for a crossfade.
  document.body.appendChild(wrap);

  // Explicit play() for Safari, which doesn't always honor the autoplay attribute.
  video.play().catch(() => {
    // Autoplay blocked — leave the first frame up; Skip and the ended handler still work.
  });
}
