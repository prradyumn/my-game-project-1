// The gameplay montage that plays before the game (made by tools/intro-video.mjs): it runs
// while the world loads, so it costs no extra waiting. Browsers only autoplay muted video, so
// it starts muted with a sound button; any key, a click or "Skip" ends it.

// (prady-intro-5m: the 8 Mbps master re-encoded two-pass at 5.5 Mbps, 24 MB instead of 36; its
// worst frame, a cross-dissolve, looks the same side by side; SSIM 0.974 over the whole clip)
const SRC = '/assets/video/prady-intro-5m.mp4';
const POSTER = '/assets/video/prady-intro-poster.jpg';

export function playIntro({ force = false, onDone } = {}) {
  const q = new URLSearchParams(location.search);
  // automated runs (tests, capture) and ?nointro skip it unless asked for
  if (!force && (q.has('nointro') || (navigator.webdriver && !q.has('intro')))) {
    onDone?.();
    return null;
  }
  const el = document.createElement('div');
  el.id = 'intro';
  el.innerHTML = `
    <video playsinline muted autoplay preload="auto" poster="${POSTER}"></video>
    <button class="intro-sound" type="button" aria-label="Turn sound on">Sound on</button>
    <button class="intro-skip" type="button">Skip <span aria-hidden="true">›</span></button>`;
  document.body.appendChild(el);
  const video = el.querySelector('video');
  const sound = el.querySelector('.intro-sound');
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('out');
    window.removeEventListener('keydown', onKey, true);
    setTimeout(() => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      el.remove();
      onDone?.();
    }, 650);
  };
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  sound.addEventListener('click', (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    if (!video.muted) video.play().catch(() => {});
    sound.textContent = video.muted ? 'Sound on' : 'Sound off';
    sound.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Turn sound off');
  });
  el.querySelector('.intro-skip').addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  video.addEventListener('click', close);
  video.addEventListener('ended', close);
  video.addEventListener('error', close);
  window.addEventListener('keydown', onKey, true);
  video.src = SRC;
  video.play().catch(() => {
    // autoplay refused even muted (rare): keep the poster and wait for a click on Skip/the video
  });
  return { close };
}
