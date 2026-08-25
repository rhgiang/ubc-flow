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
  outColor = vec4(col, alpha);
}
`;

type Palette = {
  color: [number, number, number];
  colorLow: [number, number, number];
  alpha: number;
  coverage: number;
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
    const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

    const applyPalette = () => {
      const p = isDark() ? DARK : LIGHT;
      gl.uniform3f(u.color, ...p.color);
      gl.uniform3f(u.colorLow, ...p.colorLow);
      gl.uniform1f(u.alpha, p.alpha);
      gl.uniform1f(u.coverage, p.coverage);
      gl.uniform1f(u.top, 0.0);
      gl.uniform1f(u.bottom, 1.0);
    };
    applyPalette();

    const themeWatch = new MutationObserver(applyPalette);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    let raf = 0;
    let start = performance.now();
    let elapsed = 0;

    const frame = (now: number) => {
      // Reduced motion still gets clouds, just held still.
      if (!reduced.matches) elapsed = (now - start) / 1000;
      else start = now - elapsed * 1000;

      gl.uniform1f(u.time, elapsed);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Don't burn frames on a tab nobody is looking at.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        start = performance.now() - elapsed * 1000;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

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
