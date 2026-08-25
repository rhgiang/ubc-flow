'use client';

import { useEffect, useRef } from 'react';

/**
 * Animated clouds drawn by a fragment shader.
 *
 * CSS-transformed cloud sprites can only ever slide past; real clouds also
 * billow and dissolve. This draws density from domain-warped fBm noise — a
 * stack of value-noise octaves whose sample point is itself displaced by more
 * noise — so the field evolves in place while the wind carries it sideways.
 *
 * Only the clouds live here; the sky behind them stays a CSS layer, so the
 * canvas clears to transparent and blends over whatever is underneath.
 */

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_color;
uniform vec3 u_colorLow;   // cloud colour down at the horizon
uniform float u_alpha;
uniform float u_coverage;  // raises/lowers the density cut — more or fewer clouds
uniform float u_scale;
uniform float u_top;       // where the cloud deck starts fading in, in screen Y
uniform float u_bottom;    // and where it has faded out entirely
uniform float u_precip;    // precipitation strength, 0 = none
uniform float u_ptype;     // 0 = rain streaks, 1 = snow flakes

out vec4 outColor;

// Evenly distributed over [0,1). An earlier version ended in fract(p.x * p.y),
// whose mean sits near 0.25 rather than 0.5 — that skew dragged the whole fBm
// field low and made the coverage threshold behave far more sharply than the
// numbers suggested.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Rotating each octave keeps the layers from lining up into visible grid seams.
const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p = ROT * p;
    a *= 0.5;
  }
  return v;
}

// Screen-space rain: slanted columns, each with its own phase and speed, a
// sparse hash deciding which cells actually carry a drop. Reads as rain on
// the window rather than volumetric rain — right for a backdrop.
float rain(vec2 uv, float t) {
  uv.x += uv.y * 0.16; // slant
  vec2 cell = vec2(uv.x * 90.0, uv.y * 2.4);
  float col = floor(cell.x);
  float ph = hash(vec2(col, 17.0));
  cell.y += t * (2.1 + ph * 1.5) + ph * 19.0;
  float row = floor(cell.y);
  // "active" is a reserved word in GLSL ES 3.0 — hence "occupied".
  float occupied = step(0.7, hash(vec2(col, row)));
  vec2 f = fract(cell) - 0.5;
  float streak = (1.0 - smoothstep(0.02, 0.08, abs(f.x))) *
                 (1.0 - smoothstep(0.28, 0.48, abs(f.y)));
  return streak * occupied;
}

// Two drifting layers of soft dots with per-flake jitter and a sinusoidal
// horizontal wobble.
float snow(vec2 uv, float t) {
  float acc = 0.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    vec2 g = uv * (13.0 + fi * 9.0);
    g.y += t * (0.55 + fi * 0.35);
    g.x += sin(t * 0.6 + fi * 2.1 + uv.y * 5.0) * 0.3;
    vec2 id = floor(g);
    float ph = hash(id + fi * 31.0);
    vec2 f = fract(g) - 0.5;
    vec2 off = (vec2(ph, hash(id + 7.7)) - 0.5) * 0.6;
    float d = length(f - off);
    acc += (1.0 - smoothstep(0.03 + ph * 0.03, 0.09 + ph * 0.04, d)) * step(0.45, ph);
  }
  return min(acc, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  // Correct for aspect so clouds stay round-ish on wide viewports.
  vec2 p = vec2(uv.x * (u_res.x / u_res.y), uv.y) * u_scale;

  float t = u_time;
  p.x -= t * 0.021;            // wind
  p.y += sin(t * 0.02) * 0.06; // a little vertical wander

  // Two rounds of domain warping. The offsets are arbitrary decorrelating
  // constants; the small time factors are what make the mass churn slowly
  // instead of translating rigidly.
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.02)), fbm(p + vec2(5.2, 1.3) - t * 0.015));
  vec2 r = vec2(
    fbm(p + 1.7 * q + vec2(1.7, 9.2) + t * 0.011),
    fbm(p + 1.7 * q + vec2(8.3, 2.8) - t * 0.009)
  );
  float d = fbm(p + 1.5 * r);

  // A finer, faster octave on top of the mass. Centred on zero so it only adds
  // texture — curdled edges and wisps — without shifting overall coverage.
  d += 0.11 * (fbm(p * 3.4 + r * 1.2 - t * 0.05) - 0.5);

  // Soft threshold: below the cut is clear sky, above it ramps to solid. The
  // ramp is deliberately wide — a tight one turns the noise marbled and veiny
  // rather than vaporous.
  float density = smoothstep(u_coverage, u_coverage + 0.52, d);

  // GL's Y runs up from the bottom; y here is distance down from the top edge.
  // Cloud banks up against both the top and bottom edges and thins through the
  // middle, framing the content rather than sitting behind it as a flat deck.
  float y = 1.0 - uv.y;
  float above = 1.0 - smoothstep(u_top, u_top + 0.58, y);
  // The lower bank reaches further up and carries a little more weight than the
  // upper one, which grounds the composition instead of leaving it top-heavy.
  float below = smoothstep(u_bottom - 0.92, u_bottom, y) * 1.3;
  // The floor keeps a thin haze across the clear middle so the two banks read
  // as one sky rather than two separate strips.
  float band = mix(0.24, 1.0, clamp(max(above, below), 0.0, 1.0));

  // Horizon clouds take a different colour from the ones overhead — in dusk
  // they catch the afterglow, which is the only thing that makes them legible
  // against a bright horizon.
  vec3 col = mix(u_color, u_colorLow, smoothstep(0.4, 0.95, y));
  // Denser cores read brighter than thin edges, which gives the mass some
  // internal depth rather than a flat silhouette.
  col *= 0.86 + 0.24 * density;

  float alpha = density * band * u_alpha;

  if (u_precip > 0.0) {
    // Aspect-true coordinates so drops stay the same size on any viewport.
    vec2 suv = gl_FragCoord.xy / u_res.y;
    float pr = (u_ptype < 0.5 ? rain(suv, t) : snow(suv, t)) * u_precip;
    // Rain reads as darker streaks against a grey sky; snow as white flakes.
    vec3 pcol = u_ptype < 0.5 ? u_colorLow * 0.82 : vec3(1.0);
    float pa = clamp(pr, 0.0, 1.0) * (u_ptype < 0.5 ? 0.35 : 0.8);
    col = mix(col, pcol, pa / max(alpha + pa, 0.001));
    alpha = alpha + pa * (1.0 - alpha);
  }

  outColor = vec4(col, alpha);
}
`;

/**
 * Redraw budget. The sky is deliberately slow-moving, so there is nothing to
 * gain from matching a high-refresh display — see the frame loop below.
 */
const FRAME_MS = 1000 / 30;

type Palette = {
  color: [number, number, number];
  colorLow: [number, number, number];
  alpha: number;
  coverage: number;
  /** Rain/snow strength; 0 for none. */
  precip?: number;
  /** 0 = rain, 1 = snow. */
  ptype?: number;
};

/**
 * Weather-mode adjustments layered onto the light/dark base palette. Values
 * are deltas/overrides, not full palettes, so day and night both stay in
 * their own colour family. Keyed by the data-weather attribute.
 */
const WEATHER: Record<string, Partial<Palette>> = {
  clear: { coverage: 0.42 }, // a few wisps, mostly open sky
  cloudy: {}, // the default deck already reads as partly cloudy
  overcast: { coverage: 0.06, alpha: 1.0, color: [0.93, 0.94, 0.96], colorLow: [0.85, 0.87, 0.9] },
  fog: { coverage: -0.1, alpha: 0.6, color: [0.92, 0.93, 0.95], colorLow: [0.9, 0.91, 0.93] },
  rain: {
    coverage: 0.04,
    alpha: 1.0,
    color: [0.78, 0.8, 0.85],
    colorLow: [0.68, 0.71, 0.77],
    precip: 1.0,
  },
  snow: {
    coverage: 0.06,
    alpha: 1.0,
    color: [0.9, 0.91, 0.94],
    colorLow: [0.84, 0.86, 0.9],
    precip: 1.0,
    ptype: 1,
  },
  storm: {
    coverage: 0.0,
    alpha: 1.0,
    color: [0.62, 0.64, 0.7],
    colorLow: [0.52, 0.55, 0.62],
    precip: 1.6,
  },
};

// coverage is a threshold on the noise field, which now centres near 0.5:
// lower means more sky turns to cloud.
const LIGHT: Palette = {
  color: [1.0, 1.0, 1.0],
  colorLow: [1.0, 0.99, 0.97],
  alpha: 0.98,
  coverage: 0.2,
};
const DARK: Palette = {
  color: [0.88, 0.84, 0.95],
  // Catching the afterglow, but kept markedly paler than the horizon behind
  // them — matching its warmth exactly left them invisible.
  colorLow: [1.0, 0.95, 0.89],
  alpha: 0.9,
  coverage: 0.28,
};

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('SkyClouds shader:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export default function SkyClouds() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
    });
    // No WebGL2 (or a blocked context) just means no clouds — the sky and the
    // rest of the page render fine without them.
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('SkyClouds link:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // One full-screen triangle pair.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const u = {
      res: gl.getUniformLocation(prog, 'u_res'),
      time: gl.getUniformLocation(prog, 'u_time'),
      color: gl.getUniformLocation(prog, 'u_color'),
      colorLow: gl.getUniformLocation(prog, 'u_colorLow'),
      alpha: gl.getUniformLocation(prog, 'u_alpha'),
      coverage: gl.getUniformLocation(prog, 'u_coverage'),
      scale: gl.getUniformLocation(prog, 'u_scale'),
      top: gl.getUniformLocation(prog, 'u_top'),
      bottom: gl.getUniformLocation(prog, 'u_bottom'),
      precip: gl.getUniformLocation(prog, 'u_precip'),
      ptype: gl.getUniformLocation(prog, 'u_ptype'),
    };

    // Clouds are all soft gradients, so rendering well under device resolution
    // costs nothing visually and keeps a full-screen shader cheap.
    const RES_SCALE = 0.5;
    const resize = () => {
      const w = Math.max(1, Math.floor(window.innerWidth * RES_SCALE));
      const h = Math.max(1, Math.floor(window.innerHeight * RES_SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      // Fewer, larger cloud masses on a phone than on a wide desktop.
      gl.uniform1f(u.scale, window.innerWidth < 640 ? 1.5 : 2.3);
    };
    resize();
    window.addEventListener('resize', resize);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const root = document.documentElement;
    const isContrast = () => root.getAttribute('data-theme') === 'contrast';

    const applyPalette = () => {
      const dark = root.getAttribute('data-theme') === 'dark';
      const base = dark ? DARK : LIGHT;
      const cond = root.getAttribute('data-weather');
      const over = cond ? (WEATHER[cond] ?? {}) : {};
      const p = { ...base, ...over };
      // The weather colours are daytime greys; at night pull them down so a
      // storm deck doesn't glow against the dusk sky.
      if (dark && over.color) {
        p.color = p.color.map((c) => c * 0.55) as Palette['color'];
        p.colorLow = p.colorLow.map((c) => c * 0.55) as Palette['colorLow'];
      }
      gl.uniform3f(u.color, ...p.color);
      gl.uniform3f(u.colorLow, ...p.colorLow);
      gl.uniform1f(u.alpha, p.alpha);
      gl.uniform1f(u.coverage, p.coverage);
      gl.uniform1f(u.top, 0.0);
      gl.uniform1f(u.bottom, 1.0);
      gl.uniform1f(u.precip, p.precip ?? 0);
      gl.uniform1f(u.ptype, p.ptype ?? 0);
    };
    applyPalette();

    let raf = 0;
    let start = performance.now();
    let elapsed = 0;
    let lastDraw = 0;

    const frame = (now: number) => {
      // Always queue the next callback first, so throttling never stalls the
      // loop. Uncapped, this redrew once per display refresh — on a 144Hz
      // monitor that is 2.4x the work of a 60Hz one for no visible gain, since
      // the clouds drift about 4px per second. At 30fps that is still only
      // ~0.13px of movement between frames, far below anything the eye can
      // read as judder.
      raf = requestAnimationFrame(frame);
      if (now - lastDraw < FRAME_MS) return;
      lastDraw = now;

      // Reduced motion still gets clouds, just held still.
      if (!reduced.matches) elapsed = (now - start) / 1000;
      else start = now - elapsed * 1000;

      gl.uniform1f(u.time, elapsed);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);

    // Don't burn frames on a tab nobody is looking at.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf && !isContrast()) {
        start = performance.now() - elapsed * 1000;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // High contrast is a static theme: the sky layers are hidden by CSS, so
    // drawing would be pure waste — stop the loop, restart on the way out.
    const onThemeChange = () => {
      if (isContrast()) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        return;
      }
      applyPalette();
      if (!raf && !document.hidden) {
        start = performance.now() - elapsed * 1000;
        raf = requestAnimationFrame(frame);
      }
    };
    const themeWatch = new MutationObserver(onThemeChange);
    themeWatch.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-weather'],
    });
    onThemeChange();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      themeWatch.disconnect();
      // Deliberately not calling WEBGL_lose_context here: getContext() hands
      // back the same context object for the life of the canvas, so losing it
      // on cleanup would leave StrictMode's immediate remount (and any Fast
      // Refresh) holding a dead context. The browser reclaims it with the
      // canvas.
    };
  }, []);

  return <canvas ref={ref} className="sky-layer sky-canvas" aria-hidden="true" />;
}
