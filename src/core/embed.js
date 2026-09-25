/**
 * External video (YouTube / Vimeo) links in a project's "Image N video" field.
 * They show as an embedded player in the project view; the slot's image (or
 * YouTube's own thumbnail) stands in until the visitor presses play, so no
 * third-party player loads until it's wanted.
 *
 * Add `#autoplay` to the link (e.g. https://vimeo.com/123#autoplay) to have it
 * play muted and looping with no controls or title instead, like the MP4 loops
 * (`loopSrc`). It plays while on screen and pauses when scrolled away.
 * YouTube Shorts are vertical (`aspect` 9:16); everything else is 16:9.
 *
 * MP4/WebM links keep working as before (muted loops); anything that isn't a
 * recognised YouTube/Vimeo link is treated as a video file.
 */

/** Returns { provider, id, src, loopSrc, thumb, autoplay, aspect } for a YouTube/Vimeo URL, else null. */
export function parseEmbed(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const autoplay = /(^#|&)autoplay\b/i.test(u.hash) || ['1', 'true'].includes(u.searchParams.get('autoplay'));

  let yt = null;
  const short = /^\/shorts\//.test(u.pathname);
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    yt = u.searchParams.get('v') || (/^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname) || [])[2];
  }
  if (yt && /^[\w-]{6,}$/.test(yt)) {
    const start = parseInt(u.searchParams.get('t') || u.searchParams.get('start'), 10);
    const params = new URLSearchParams({ rel: '0', playsinline: '1', ...(start ? { start: String(start) } : {}) });
    // Muted loop: no controls, loops itself (playlist = the video), JS API on so it can pause off screen.
    // YouTube no longer lets embeds hide the title bar; the project view crops it off (see project.js).
    const loop = new URLSearchParams({ autoplay: '1', mute: '1', loop: '1', playlist: yt, controls: '0', disablekb: '1', fs: '0', iv_load_policy: '3', cc_load_policy: '0', modestbranding: '1', rel: '0', playsinline: '1', enablejsapi: '1' });
    return {
      provider: 'youtube',
      id: yt,
      src: `https://www.youtube-nocookie.com/embed/${yt}?${params}`,
      loopSrc: `https://www.youtube-nocookie.com/embed/${yt}?${loop}`,
      thumb: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      autoplay,
      aspect: short ? 9 / 16 : 16 / 9,
    };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    // vimeo.com/123, vimeo.com/123/abcdef (unlisted), vimeo.com/channels/x/123, player.vimeo.com/video/123?h=abcdef
    const parts = u.pathname.split('/').filter(Boolean);
    const i = parts.findIndex((p) => /^\d+$/.test(p));
    if (i >= 0) {
      const id = parts[i];
      const hash = u.searchParams.get('h') || (parts[i + 1] && /^[\da-f]+$/i.test(parts[i + 1]) ? parts[i + 1] : '');
      const params = new URLSearchParams({ ...(hash ? { h: hash } : {}), title: '0', byline: '0', portrait: '0', dnt: '1' });
      // background=1 = muted, looping, no controls or title (Vimeo ignores it on free accounts; the rest still apply).
      const loop = new URLSearchParams({ ...(hash ? { h: hash } : {}), background: '1', autoplay: '1', muted: '1', loop: '1', autopause: '0', controls: '0', title: '0', byline: '0', portrait: '0', badge: '0', pip: '0', keyboard: '0', dnt: '1' });
      return { provider: 'vimeo', id, src: `https://player.vimeo.com/video/${id}?${params}`, loopSrc: `https://player.vimeo.com/video/${id}?${loop}`, thumb: '', autoplay, aspect: 16 / 9 };
    }
  }
  return null;
}

/** The player URL, set to start playing (used when the visitor presses play). */
export function autoplaySrc(embed) {
  const url = new URL(embed.src);
  url.searchParams.set('autoplay', '1');
  return url.href;
}

/** Plays or pauses a looping player (YouTube / Vimeo postMessage APIs). */
export function commandLoop(frame, play) {
  const win = frame.contentWindow;
  if (!win) return;
  if (frame.dataset.provider === 'youtube') win.postMessage(JSON.stringify({ event: 'command', func: play ? 'playVideo' : 'pauseVideo', args: [] }), '*');
  else win.postMessage(JSON.stringify({ method: play ? 'play' : 'pause' }), '*');
}

/** Asks a looping player to report playback, so it can stay hidden behind the thumbnail until it's actually playing. */
export function listenLoop(frame) {
  const win = frame.contentWindow;
  if (!win) return;
  if (frame.dataset.provider === 'youtube') win.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
  else win.postMessage(JSON.stringify({ method: 'addEventListener', value: 'play' }), '*');
}

/** True for a player message that means "playing". */
export function isPlayingMessage(e) {
  let host = '';
  try {
    host = new URL(e.origin).hostname; // origin can be "null"
  } catch {
    return false;
  }
  if (!/(^|\.)(youtube-nocookie|youtube|vimeo)\.com$/.test(host)) return false;
  let d = e.data;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      return false;
    }
  }
  return (d?.event === 'onStateChange' && d.info === 1) || (d?.event === 'infoDelivery' && d.info?.playerState === 1) || d?.event === 'play';
}
