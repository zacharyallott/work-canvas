/**
 * External video (YouTube / Vimeo) links in a project's "Image N video" field.
 * They show as an embedded player in the project view; the slot's image (or
 * YouTube's own thumbnail) stands in until the visitor presses play, so no
 * third-party player loads until it's wanted.
 *
 * MP4/WebM links keep working as before (muted loops); anything that isn't a
 * recognised YouTube/Vimeo link is treated as a video file.
 */

/** Returns { provider, id, src, thumb } for a YouTube/Vimeo URL, else null. */
export function parseEmbed(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');

  let yt = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    yt = u.searchParams.get('v') || (/^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname) || [])[2];
  }
  if (yt && /^[\w-]{6,}$/.test(yt)) {
    const start = parseInt(u.searchParams.get('t') || u.searchParams.get('start'), 10);
    const params = new URLSearchParams({ rel: '0', playsinline: '1', ...(start ? { start: String(start) } : {}) });
    return {
      provider: 'youtube',
      id: yt,
      src: `https://www.youtube-nocookie.com/embed/${yt}?${params}`,
      thumb: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
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
      return { provider: 'vimeo', id, src: `https://player.vimeo.com/video/${id}?${params}`, thumb: '' };
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
