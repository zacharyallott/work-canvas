/**
 * Tile shader. Every tile is a subdivided 1×1 plane scaled to its pixel size.
 *
 * Vertex:   optional bend (driven by scroll velocity).
 * Fragment: object-fit: cover, rounded corners (SDF, antialiased), hover lens
 *           distortion around the pointer, RGB split, reveal wipe, fade.
 *
 * Colours pass straight through (textures are NoColorSpace, renderer output is
 * linear) so pixels match the source files and the CSS background exactly.
 */

export const vertexShader = /* glsl */ `
  uniform vec2 uSize;     // tile size in CSS px
  uniform float uBend;    // px of vertical bend at the tile's centre
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 p = position;
    p.y += sin(uv.x * 3.14159265) * uBend / max(uSize.y, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uTexReady;  // 0 → placeholder colour, 1 → texture (tweened for a fade-in)
  uniform vec2 uTexSize;    // texture px (only the ratio matters)
  uniform vec2 uSize;       // tile CSS px
  uniform float uRadius;    // corner radius, CSS px
  uniform float uDpr;
  uniform vec3 uBase;       // placeholder colour

  uniform float uHover;     // 0..1
  uniform vec2 uMouse;      // pointer in tile uv space
  uniform float uDistort;   // lens strength
  uniform float uZoom;      // extra texture zoom (0 = cover)
  uniform float uShift;     // RGB split, in uv units
  uniform float uGray;      // 0..1 desaturation
  uniform float uAlpha;
  uniform float uReveal;    // 0..1 wipe from the bottom

  varying vec2 vUv;

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 uv = vUv;

    // object-fit: cover
    float planeA = uSize.x / max(uSize.y, 1.0);
    float texA = uTexSize.x / max(uTexSize.y, 1.0);
    vec2 cover = planeA > texA ? vec2(1.0, texA / planeA) : vec2(planeA / texA, 1.0);
    vec2 tuv = (uv - 0.5) * cover / (1.0 + uZoom) + 0.5;

    // hover lens: texels near the pointer are pulled toward it (a soft magnifier)
    vec2 fromMouse = uv - uMouse;
    float falloff = smoothstep(0.6, 0.0, length(fromMouse * vec2(planeA, 1.0)));
    tuv -= fromMouse * cover * falloff * uDistort * uHover;

    vec2 shift = vec2(uShift, 0.0) * cover;
    vec3 tex = vec3(
      texture2D(uTex, tuv + shift).r,
      texture2D(uTex, tuv).g,
      texture2D(uTex, tuv - shift).b
    );
    vec3 col = mix(uBase, tex, uTexReady);
    col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uGray);

    // rounded corners, ~1 device px of antialiasing
    float d = sdRoundBox((uv - 0.5) * uSize, uSize * 0.5, uRadius);
    float aa = 0.75 / uDpr;
    float mask = 1.0 - smoothstep(-aa, aa, d);

    // reveal wipe (uv.y = 0 at the bottom edge)
    float reveal = uReveal >= 1.0 ? 1.0 : step(uv.y, uReveal);

    gl_FragColor = vec4(col, uAlpha * mask * reveal);
  }
`;
