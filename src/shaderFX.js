/**
 * ShaderFX — Multi-layer WebGL post-processing with blend modes.
 *
 * Supports:
 *  - Up to 3 stackable shader layers, each with its own preset + intensity + blend mode
 *  - Ping-pong framebuffers for chaining layers
 *  - Shadertoy-compatible GLSL import via paste
 *  - 11 built-in presets + unlimited custom imports
 *  - Audio-reactive uniforms: u_bass, u_mid, u_treble, u_energy, u_beat
 */

// ── State ─────────────────────────────────────────────────────────────────────

let gl = null;
let glCanvas = null;
let programs = {};           // cached compiled programs keyed by preset name
let quadVBO = null;
let sourceTexture = null;
let startTime = 0;

// Ping-pong framebuffers for multi-layer chaining
let fboA = null, fboTexA = null;
let fboB = null, fboTexB = null;
let fboC = null, fboTexC = null;  // temp FBO for effect passes (avoids feedback loops)
let fboWidth = 0, fboHeight = 0;

// Blend composite program
let blendProgram = null;

// Layer stack (max 3)
const MAX_LAYERS = 3;
let layers = [];  // { preset: string, intensity: number, blendMode: string }

// Custom imported shaders
const customShaders = {};  // name → GLSL source

function saveCustomShadersToStorage() {
    try {
        const data = {};
        for (const [k, v] of Object.entries(customShaders)) data[k] = v;
        localStorage.setItem('fractal_custom_shaders', JSON.stringify(data));
    } catch (e) { /* quota exceeded or private mode */ }
}

function loadCustomShadersFromStorage() {
    try {
        const raw = localStorage.getItem('fractal_custom_shaders');
        if (!raw) return;
        const data = JSON.parse(raw);
        for (const [name, src] of Object.entries(data)) {
            customShaders[name] = src;
        }
    } catch (e) { /* corrupted data */ }
}

// ── Vertex Shader (shared) ────────────────────────────────────────────────────

const VERT_SRC = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// ── Blend Composite Fragment Shader ───────────────────────────────────────────

const BLEND_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform float u_intensity;
uniform int u_blendMode;

vec3 blendScreen(vec3 base, vec3 blend) {
    return 1.0 - (1.0 - base) * (1.0 - blend);
}

vec3 blendOverlay(vec3 base, vec3 blend) {
    vec3 result;
    for (int i = 0; i < 3; i++) {
        if (i == 0) result.r = base.r < 0.5 ? 2.0*base.r*blend.r : 1.0 - 2.0*(1.0-base.r)*(1.0-blend.r);
        if (i == 1) result.g = base.g < 0.5 ? 2.0*base.g*blend.g : 1.0 - 2.0*(1.0-base.g)*(1.0-blend.g);
        if (i == 2) result.b = base.b < 0.5 ? 2.0*base.b*blend.b : 1.0 - 2.0*(1.0-base.b)*(1.0-blend.b);
    }
    return result;
}

void main() {
    vec4 base = texture2D(u_base, v_uv);
    vec4 layer = texture2D(u_layer, v_uv);

    vec3 blended;
    if (u_blendMode == 0) {
        // Normal
        blended = layer.rgb;
    } else if (u_blendMode == 1) {
        // Screen
        blended = blendScreen(base.rgb, layer.rgb);
    } else if (u_blendMode == 2) {
        // Overlay
        blended = blendOverlay(base.rgb, layer.rgb);
    } else if (u_blendMode == 3) {
        // Add
        blended = min(base.rgb + layer.rgb, 1.0);
    } else if (u_blendMode == 4) {
        // Multiply
        blended = base.rgb * layer.rgb;
    } else {
        blended = layer.rgb;
    }

    gl_FragColor = vec4(mix(base.rgb, blended, u_intensity), base.a);
}
`;

// ── Fragment Shader Presets ───────────────────────────────────────────────────

const PRESETS = {

    kaleidoscope: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_bass;
    uniform float u_energy;
    uniform float u_intensity;

    void main() {
        vec2 uv = v_uv - 0.5;
        float angle = atan(uv.y, uv.x);
        float radius = length(uv);
        float segments = 4.0 + u_bass * 8.0;
        float segAngle = 3.14159265 * 2.0 / segments;
        angle = mod(angle, segAngle);
        if (angle > segAngle * 0.5) angle = segAngle - angle;
        vec2 kalUV = vec2(cos(angle), sin(angle)) * radius + 0.5;
        vec4 orig = texture2D(u_texture, v_uv);
        vec4 kal = texture2D(u_texture, kalUV);
        gl_FragColor = mix(orig, kal, u_intensity);
    }
  `,

    liquid: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_bass;
    uniform float u_intensity;

    void main() {
        vec2 uv = v_uv;
        float amp = u_intensity * 0.04 * (1.0 + u_bass * 2.0);
        uv.x += sin(uv.y * 12.0 + u_time * 2.0) * amp;
        uv.y += cos(uv.x * 10.0 + u_time * 1.5) * amp;
        uv.x += sin(uv.y * 6.0 - u_time * 0.8) * amp * 0.5;
        gl_FragColor = texture2D(u_texture, uv);
    }
  `,

    rgbShift: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_energy;
    uniform float u_beat;
    uniform float u_intensity;

    void main() {
        float offset = u_intensity * 0.015 * (1.0 + u_energy * 3.0 + u_beat * 2.0);
        float angle = u_time * 0.5;
        vec2 dir = vec2(cos(angle), sin(angle)) * offset;
        float r = texture2D(u_texture, v_uv + dir).r;
        float g = texture2D(u_texture, v_uv).g;
        float b = texture2D(u_texture, v_uv - dir).b;
        float a = texture2D(u_texture, v_uv).a;
        gl_FragColor = vec4(r, g, b, a);
    }
  `,

    tunnel: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_energy;
    uniform float u_bass;
    uniform float u_intensity;

    void main() {
        vec2 center = vec2(0.5);
        vec2 uv = v_uv - center;
        float dist = length(uv);
        float zoom = 1.0 - u_intensity * 0.3 * (0.5 + u_energy);
        float rotation = u_time * 0.1 * u_intensity * (1.0 + u_bass);
        float cs = cos(rotation);
        float sn = sin(rotation);
        uv = mat2(cs, -sn, sn, cs) * uv;
        uv = uv * zoom + center;
        vec4 texColor = texture2D(u_texture, uv);
        float glow = 1.0 + smoothstep(0.5, 0.0, dist) * u_intensity * 0.5;
        gl_FragColor = texColor * glow;
    }
  `,

    pixelMosaic: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform float u_beat;
    uniform float u_energy;
    uniform float u_intensity;

    void main() {
        float blockSize = mix(1.0, 20.0, u_intensity) * (1.0 + u_beat * 5.0);
        blockSize = max(1.0, blockSize);
        vec2 blocks = u_resolution / blockSize;
        vec2 pixUV = floor(v_uv * blocks) / blocks;
        pixUV += 0.5 / blocks;
        vec4 orig = texture2D(u_texture, v_uv);
        vec4 pix = texture2D(u_texture, pixUV);
        gl_FragColor = mix(orig, pix, u_intensity);
    }
  `,

    edgeGlow: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform float u_treble;
    uniform float u_energy;
    uniform float u_intensity;

    void main() {
        vec2 texel = 1.0 / u_resolution;
        vec3 tl = texture2D(u_texture, v_uv + vec2(-texel.x, -texel.y)).rgb;
        vec3 t  = texture2D(u_texture, v_uv + vec2(0.0, -texel.y)).rgb;
        vec3 tr = texture2D(u_texture, v_uv + vec2(texel.x, -texel.y)).rgb;
        vec3 l  = texture2D(u_texture, v_uv + vec2(-texel.x, 0.0)).rgb;
        vec3 r  = texture2D(u_texture, v_uv + vec2(texel.x, 0.0)).rgb;
        vec3 bl = texture2D(u_texture, v_uv + vec2(-texel.x, texel.y)).rgb;
        vec3 b  = texture2D(u_texture, v_uv + vec2(0.0, texel.y)).rgb;
        vec3 br = texture2D(u_texture, v_uv + vec2(texel.x, texel.y)).rgb;
        vec3 gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
        vec3 gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
        float edge = length(gx) + length(gy);
        float glowStrength = edge * u_intensity * 3.0 * (1.0 + u_treble * 4.0);
        vec3 neon = vec3(0.2, 0.8, 1.0) * glowStrength;
        vec4 orig = texture2D(u_texture, v_uv);
        gl_FragColor = vec4(orig.rgb + neon, orig.a);
    }
  `,

    colorCycle: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_energy;
    uniform float u_mid;
    uniform float u_intensity;

    vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0*d + e)), d / (q.x + e), q.x);
    }
    vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }
    void main() {
        vec4 texColor = texture2D(u_texture, v_uv);
        vec3 hsv = rgb2hsv(texColor.rgb);
        float shift = u_time * 0.2 * u_intensity * (1.0 + u_energy * 2.0);
        shift += u_mid * u_intensity * 0.3;
        hsv.x = fract(hsv.x + shift);
        hsv.y = min(1.0, hsv.y * (1.0 + u_intensity * 0.4));
        vec3 shifted = hsv2rgb(hsv);
        gl_FragColor = vec4(mix(texColor.rgb, shifted, u_intensity), texColor.a);
    }
  `,

    glitch: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_energy;
    uniform float u_beat;
    uniform float u_intensity;

    float rand(vec2 co) {
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
        vec2 uv = v_uv;
        float glitchAmount = u_intensity * (0.3 + u_energy * 0.7 + u_beat * 2.0);
        float blockY = floor(uv.y * 20.0) / 20.0;
        float noise = rand(vec2(blockY, floor(u_time * 8.0)));
        if (noise > 1.0 - glitchAmount * 0.3) {
            uv.x += (rand(vec2(blockY, u_time)) - 0.5) * glitchAmount * 0.15;
        }
        if (rand(vec2(u_time * 3.0, uv.y * 100.0)) > 1.0 - glitchAmount * 0.1) {
            uv.x += (rand(vec2(uv.y, u_time * 5.0)) - 0.5) * 0.02 * glitchAmount;
        }
        float r = texture2D(u_texture, uv + vec2(glitchAmount * 0.01, 0.0)).r;
        float g = texture2D(u_texture, uv).g;
        float b = texture2D(u_texture, uv - vec2(glitchAmount * 0.01, 0.0)).b;
        vec4 orig = texture2D(u_texture, v_uv);
        vec4 glitched = vec4(r, g, b, 1.0);
        gl_FragColor = mix(orig, glitched, min(1.0, u_intensity));
    }
  `,

    // ── New Curated Presets ──────────────────────────────────────────────────

    domainWarp: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_bass;
    uniform float u_energy;
    uniform float u_intensity;

    // FBM-based domain warping (inspired by Inigo Quilez's techniques)
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
        for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p = rot * p * 2.0;
            a *= 0.5;
        }
        return v;
    }
    void main() {
        vec2 uv = v_uv;
        float t = u_time * 0.3;
        float strength = u_intensity * 0.12 * (1.0 + u_bass * 2.0);

        // Double domain warp
        float f1 = fbm(uv * 4.0 + t);
        float f2 = fbm(uv * 4.0 + f1 * 2.0 + t * 0.7);
        vec2 warp = vec2(
            fbm(uv * 3.0 + vec2(f1, f2) + t * 0.5),
            fbm(uv * 3.0 + vec2(f2, f1) - t * 0.3)
        );
        uv += (warp - 0.5) * strength;
        gl_FragColor = texture2D(u_texture, uv);
    }
  `,

    heatDistort: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_energy;
    uniform float u_treble;
    uniform float u_intensity;

    void main() {
        vec2 uv = v_uv;
        // Rising heat waves
        float wave1 = sin(uv.x * 25.0 + u_time * 3.0) * cos(uv.y * 15.0 - u_time * 2.0);
        float wave2 = sin(uv.x * 40.0 - u_time * 1.5) * cos(uv.y * 30.0 + u_time * 2.5);
        float wave3 = sin((uv.x + uv.y) * 20.0 + u_time * 4.0);

        float distort = (wave1 + wave2 * 0.5 + wave3 * 0.3) * u_intensity * 0.008;
        distort *= (1.0 + u_energy * 3.0 + u_treble * 2.0);

        // Upward drift bias
        uv.x += distort;
        uv.y += distort * 0.7 + u_intensity * 0.002 * sin(u_time);

        vec4 color = texture2D(u_texture, uv);
        // Subtle warm tint
        color.r += u_intensity * 0.05 * u_energy;
        gl_FragColor = color;
    }
  `,

    voidRipple: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_bass;
    uniform float u_beat;
    uniform float u_energy;
    uniform float u_intensity;

    void main() {
        vec2 center = vec2(0.5);
        vec2 uv = v_uv;
        vec2 delta = uv - center;
        float dist = length(delta);

        // Concentric ripples — bass drives frequency, beat drives amplitude
        float freq = 15.0 + u_bass * 20.0;
        float amp = u_intensity * 0.025 * (1.0 + u_beat * 3.0);
        float ripple = sin(dist * freq - u_time * 4.0) * amp;
        ripple *= smoothstep(0.6, 0.0, dist); // fade toward edges

        // Second harmonic
        float ripple2 = sin(dist * freq * 1.7 + u_time * 2.5) * amp * 0.4;

        vec2 offset = normalize(delta + 0.001) * (ripple + ripple2);
        uv += offset;

        vec4 color = texture2D(u_texture, uv);
        // Darken center on beat
        float vignette = 1.0 - u_beat * u_intensity * 0.3 * smoothstep(0.3, 0.0, dist);
        gl_FragColor = color * vignette;
    }
  `,

    starNest: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_bass;
    uniform float u_energy;
    uniform float u_intensity;

    // Adapted from "Star Nest" by Pablo Roman Andrioli (Kali)
    void main() {
        vec2 uv = (v_uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
        float t = u_time * 0.08 + u_bass * 0.3;
        vec3 dir = normalize(vec3(uv * 2.0, 1.0));
        vec3 from = vec3(0.0, 0.0, t);
        float volsteps = 0.0;
        float s = 0.1;
        float fade = 0.8;
        vec3 v = vec3(0.0);
        for (int r = 0; r < 12; r++) {
            vec3 p = from + s * dir * 0.5;
            p = abs(vec3(1.2) - mod(p, vec3(2.4)));
            float pa, a = pa = 0.0;
            for (int i = 0; i < 10; i++) {
                p = abs(p) / dot(p, p) - 0.62;
                a += abs(length(p) - pa);
                pa = length(p);
            }
            a *= a * a;
            v += fade * vec3(s, s * s, s * s * s * s) * a * 0.0025;
            fade *= 0.73;
            s += 0.12;
        }
        v = clamp(v, 0.0, 1.0);
        vec4 orig = texture2D(u_texture, v_uv);
        gl_FragColor = mix(orig, vec4(v * (1.0 + u_energy), 1.0), u_intensity);
    }
  `,

    plasmaGlobe: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_bass;
    uniform float u_treble;
    uniform float u_energy;
    uniform float u_beat;
    uniform float u_intensity;

    float noise(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
        vec2 uv = (v_uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
        float t = u_time * 0.6 + u_bass;
        float dist = length(uv);
        float glow = 0.0;

        for (int i = 0; i < 6; i++) {
            float fi = float(i) * 1.047 + t;
            vec2 dir = vec2(cos(fi), sin(fi));
            float bolt = abs(dot(uv, dir));
            float wave = sin(dot(uv, dir.yx) * 12.0 + t * 3.0 + float(i)) * 0.03;
            bolt = 0.004 / (bolt + wave + 0.001);
            bolt *= smoothstep(0.65, 0.0, dist);
            glow += bolt;
        }

        float core = 0.02 / (dist + 0.02);
        float pulse = 1.0 + u_beat * 0.5;
        vec3 col = vec3(0.3, 0.5, 1.0) * glow * pulse + vec3(0.6, 0.8, 1.0) * core;
        col += vec3(0.8, 0.4, 1.0) * u_treble * glow * 0.3;
        col = clamp(col, 0.0, 1.0);

        vec4 orig = texture2D(u_texture, v_uv);
        gl_FragColor = mix(orig, vec4(col, 1.0), u_intensity);
    }
  `,

    aurora: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_bass;
    uniform float u_mid;
    uniform float u_energy;
    uniform float u_intensity;

    void main() {
        vec2 uv = v_uv;
        float t = u_time * 0.3;
        float ar = u_resolution.x / u_resolution.y;
        vec2 p = (uv - 0.5) * vec2(ar, 1.0);

        float aurora = 0.0;
        vec3 col = vec3(0.0);
        for (int i = 0; i < 5; i++) {
            float fi = float(i);
            float y = p.y + 0.15 + fi * 0.06;
            float wave = sin(p.x * 3.0 + t + fi * 0.7) * 0.08;
            wave += sin(p.x * 7.0 - t * 1.3 + fi) * 0.03;
            wave += sin(p.x * 13.0 + t * 0.7 + fi * 2.0) * 0.015;
            wave += u_bass * sin(p.x * 5.0 + t * 2.0) * 0.04;
            float band = 0.005 / (abs(y + wave) + 0.005);
            float hue = fi * 0.2 + t * 0.1 + p.x * 0.3;
            vec3 c = 0.5 + 0.5 * cos(6.28 * (hue + vec3(0.0, 0.33, 0.67)));
            col += c * band * (0.5 + u_energy * 0.5);
        }

        col *= smoothstep(0.5, 0.0, abs(p.y + 0.1)) * 1.5;
        col = clamp(col, 0.0, 1.0);

        vec4 orig = texture2D(u_texture, v_uv);
        gl_FragColor = mix(orig, vec4(col, 1.0), u_intensity);
    }
  `,

    ocean: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_bass;
    uniform float u_energy;
    uniform float u_intensity;

    // Caustic pattern
    float caustic(vec2 p, float t) {
        float c = 0.0;
        vec2 i = p;
        for (int n = 0; n < 4; n++) {
            float ft = t * (1.0 - 0.15 * float(n));
            i = p + vec2(
                cos(i.x + ft) + cos(i.y + ft) + sin(ft * 0.3),
                sin(i.x - ft) + sin(i.y + ft * 0.7) + cos(ft * 0.5)
            );
            c += 1.0 / length(vec2(
                p.x / (sin(i.x + ft) + 1.5),
                p.y / (cos(i.y + ft * 0.8) + 1.5)
            ));
        }
        c /= 4.0;
        return clamp(c * c * 0.06, 0.0, 1.0);
    }

    void main() {
        vec2 uv = v_uv;
        float t = u_time * 0.4 + u_bass * 0.5;
        float ar = u_resolution.x / u_resolution.y;
        vec2 p = (uv - 0.5) * vec2(ar, 1.0) * 3.0;

        float c = caustic(p, t);

        // Refract the source texture
        vec2 refract = vec2(
            sin(uv.y * 20.0 + t * 2.0) * 0.005,
            cos(uv.x * 18.0 + t * 1.5) * 0.005
        ) * u_intensity;

        vec4 orig = texture2D(u_texture, uv + refract);
        vec3 water = vec3(0.05, 0.3, 0.5) + vec3(0.3, 0.6, 0.7) * c * (1.0 + u_energy);
        gl_FragColor = mix(orig, vec4(orig.rgb + water * 0.7, 1.0), u_intensity);
    }
  `,

    warpTunnel: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_bass;
    uniform float u_energy;
    uniform float u_beat;
    uniform float u_intensity;

    void main() {
        vec2 uv = (v_uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
        float t = u_time * 0.5 + u_beat * 0.3;
        float dist = length(uv);
        float angle = atan(uv.y, uv.x);

        // Tunnel coordinates
        float tunnel_z = 0.5 / (dist + 0.01) + t * 2.0;
        float tunnel_a = angle / 3.14159 + t * 0.1;

        // Streaks
        float streaks = 0.0;
        for (int i = 0; i < 8; i++) {
            float fi = float(i);
            float a = fi * 0.785 + t * 0.3;
            float streak = abs(sin(angle * 4.0 + a));
            streak = 0.01 / (streak + 0.01);
            streak *= smoothstep(0.5, 0.0, dist);
            streak *= (0.5 + 0.5 * sin(tunnel_z * 2.0 + fi));
            streaks += streak * 0.08;
        }

        // Speed lines
        float speed = 0.03 / (dist + 0.03);
        speed *= 1.0 + u_energy * 2.0;

        vec3 col = vec3(0.2, 0.5, 1.0) * streaks;
        col += vec3(0.8, 0.9, 1.0) * speed * 0.3;
        col += vec3(0.4, 0.2, 0.8) * u_bass * speed * 0.5;
        col = clamp(col, 0.0, 1.0);

        vec4 orig = texture2D(u_texture, v_uv);
        gl_FragColor = mix(orig, vec4(col, 1.0), u_intensity);
    }
  `,

    // ── Shadertoy Ports ──────────────────────────────────────────────────────
    // Credit: Danilo Guanabara (Silexars) — shadertoy.com/view/XsXXDn
    // License: CC BY-NC-SA 3.0

    stCreation: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_intensity;

    void main() {
        vec3 c;
        float l, z = u_time;
        for (int i = 0; i < 3; i++) {
            vec2 uv, p = v_uv;
            uv = p;
            p -= 0.5;
            p.x *= u_resolution.x / u_resolution.y;
            z += 0.07;
            l = length(p);
            uv += p / l * (sin(z) + 1.0) * abs(sin(l * 9.0 - z - z));
            c[i] = 0.01 / length(mod(uv, 1.0) - 0.5);
        }
        vec4 effect = vec4(c / l, 1.0);
        vec4 orig = texture2D(u_texture, v_uv);
        gl_FragColor = mix(orig, effect, u_intensity);
    }
  `,

    // Credit: Martijn Steinrucken (BigWIngs) — shadertoy.com/view/MdXSzS
    // License: CC BY-NC-SA 3.0

    stUniverseWithin: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_bass;
    uniform float u_intensity;

    #define NUM_LAYERS 4.0

    float N21(vec2 p) {
        vec3 a = fract(vec3(p.xyx) * vec3(213.897, 653.453, 253.098));
        a += dot(a, a.yzx + 79.76);
        return fract((a.x + a.y) * a.z);
    }
    vec2 GetPos(vec2 id, vec2 offs, float t) {
        float n = N21(id + offs);
        float n1 = fract(n * 10.0);
        float n2 = fract(n * 100.0);
        float a = t + n;
        return offs + vec2(sin(a * n1), cos(a * n2)) * 0.4;
    }
    float df_line(in vec2 a, in vec2 b, in vec2 p) {
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h);
    }
    float line(vec2 a, vec2 b, vec2 uv) {
        float d = df_line(a, b, uv);
        float d2 = length(a - b);
        float fade = smoothstep(1.5, 0.5, d2);
        fade += smoothstep(0.05, 0.02, abs(d2 - 0.75));
        return smoothstep(0.04, 0.01, d) * fade;
    }
    float NetLayer(vec2 st, float n, float t) {
        vec2 id = floor(st) + n;
        st = fract(st) - 0.5;
        // Unrolled array fill — WebGL 1 forbids dynamic array indexing
        vec2 p0 = GetPos(id, vec2(-1.0, -1.0), t);
        vec2 p1 = GetPos(id, vec2( 0.0, -1.0), t);
        vec2 p2 = GetPos(id, vec2( 1.0, -1.0), t);
        vec2 p3 = GetPos(id, vec2(-1.0,  0.0), t);
        vec2 p4 = GetPos(id, vec2( 0.0,  0.0), t);
        vec2 p5 = GetPos(id, vec2( 1.0,  0.0), t);
        vec2 p6 = GetPos(id, vec2(-1.0,  1.0), t);
        vec2 p7 = GetPos(id, vec2( 0.0,  1.0), t);
        vec2 p8 = GetPos(id, vec2( 1.0,  1.0), t);
        float m = 0.0;
        // Center connections + point glow for each of 9 points
        m += line(p4, p0, st); { float d = length(st - p0); m += (0.005 / (d * d)) * smoothstep(1.0, 0.7, d) * pow(sin((fract(p0.x) + fract(p0.y) + t) * 5.0) * 0.4 + 0.6, 20.0); }
        m += line(p4, p1, st); { float d = length(st - p1); m += (0.005 / (d * d)) * smoothstep(1.0, 0.7, d) * pow(sin((fract(p1.x) + fract(p1.y) + t) * 5.0) * 0.4 + 0.6, 20.0); }
        m += line(p4, p2, st); { float d = length(st - p2); m += (0.005 / (d * d)) * smoothstep(1.0, 0.7, d) * pow(sin((fract(p2.x) + fract(p2.y) + t) * 5.0) * 0.4 + 0.6, 20.0); }
        m += line(p4, p3, st); { float d = length(st - p3); m += (0.005 / (d * d)) * smoothstep(1.0, 0.7, d) * pow(sin((fract(p3.x) + fract(p3.y) + t) * 5.0) * 0.4 + 0.6, 20.0); }
        m += line(p4, p4, st); { float d = length(st - p4); m += (0.005 / (d * d)) * smoothstep(1.0, 0.7, d) * pow(sin((fract(p4.x) + fract(p4.y) + t) * 5.0) * 0.4 + 0.6, 20.0); }
        m += line(p4, p5, st); { float d = length(st - p5); m += (0.005 / (d * d)) * smoothstep(1.0, 0.7, d) * pow(sin((fract(p5.x) + fract(p5.y) + t) * 5.0) * 0.4 + 0.6, 20.0); }
        m += line(p4, p6, st); { float d = length(st - p6); m += (0.005 / (d * d)) * smoothstep(1.0, 0.7, d) * pow(sin((fract(p6.x) + fract(p6.y) + t) * 5.0) * 0.4 + 0.6, 20.0); }
        m += line(p4, p7, st); { float d = length(st - p7); m += (0.005 / (d * d)) * smoothstep(1.0, 0.7, d) * pow(sin((fract(p7.x) + fract(p7.y) + t) * 5.0) * 0.4 + 0.6, 20.0); }
        m += line(p4, p8, st); { float d = length(st - p8); m += (0.005 / (d * d)) * smoothstep(1.0, 0.7, d) * pow(sin((fract(p8.x) + fract(p8.y) + t) * 5.0) * 0.4 + 0.6, 20.0); }
        // Perimeter lines
        m += line(p1, p3, st) + line(p1, p5, st) + line(p7, p5, st) + line(p7, p3, st);
        return m;
    }
    void main() {
        vec2 uv = (v_uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
        float t = u_time * 0.1 + u_bass * 0.2;
        float cs = cos(t), sn = sin(t);
        vec2 st = uv * mat2(cs, -sn, sn, cs);
        float m = 0.0;
        for (float i = 0.0; i < 1.0; i += 1.0 / NUM_LAYERS) {
            float z = fract(t + i);
            float size = mix(15.0, 1.0, z);
            float fade = smoothstep(0.0, 0.6, z) * smoothstep(1.0, 0.8, z);
            m += fade * NetLayer(st * size, i, u_time);
        }
        vec3 baseCol = vec3(sin(t) * 0.4 + 0.6, cos(t * 0.4) * 0.4 + 0.6, -sin(t * 0.24) * 0.4 + 0.6);
        vec3 col = baseCol * m * (1.0 - dot(uv, uv));
        vec4 orig = texture2D(u_texture, v_uv);
        gl_FragColor = mix(orig, vec4(col, 1.0), u_intensity);
    }
  `,

    // Credit: nimitz (twitter @stormoid) — shadertoy.com/view/WtdSDs
    // License: CC BY-NC-SA 3.0

    stProteanClouds: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_bass;
    uniform float u_energy;
    uniform float u_intensity;

    mat2 rot(in float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
    float mag2(vec2 p) { return dot(p, p); }
    float linstep(in float mn, in float mx, in float x) { return clamp((x - mn) / (mx - mn), 0.0, 1.0); }
    vec2 disp(float t) { return vec2(sin(t * 0.22) * 1.0, cos(t * 0.175) * 1.0) * 2.0; }

    vec2 mapClouds(vec3 p) {
        // Nimitz's original noise field with rotation matrix
        vec3 p2 = p;
        p2.xy -= disp(p.z).xy;
        p.xy *= rot(sin(p.z + u_time) * 0.1 + u_time * 0.09);
        float cl = mag2(p2.xy);
        float d = 0.0;
        p *= 0.61;
        float z = 1.0, trk = 1.0;
        for (int i = 0; i < 5; i++) {
            p += sin(p.zxy * 0.75 * trk + u_time * trk * 0.8) * 0.1;
            d -= abs(dot(cos(p), sin(p.yzx)) * z);
            z *= 0.57; trk *= 1.4;
            // Inline rotation matrix multiply (nimitz's m3)
            p = mat3(0.33338, 0.56034, -0.71817,
                     -0.87887, 0.32651, -0.15323,
                     0.15162, 0.69596, 0.61339) * p * 1.93;
        }
        return vec2(d + cl * 0.2 + 0.25, cl);
    }
    void main() {
        vec2 p = (v_uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
        float time = u_time * 3.0 + u_bass * 2.0;
        vec3 ro = vec3(0.0, 0.0, time);
        ro.xy += disp(ro.z) * 0.85;
        vec3 target = normalize(ro - vec3(disp(time + 3.5) * 0.85, time + 3.5));
        vec3 rightdir = normalize(cross(target, vec3(0.0, 1.0, 0.0)));
        vec3 updir = normalize(cross(rightdir, target));
        vec3 rd = normalize((p.x * rightdir + p.y * updir) * 1.0 - target);

        vec4 rez = vec4(0.0);
        float t = 1.5;
        for (int i = 0; i < 80; i++) {
            if (rez.a > 0.99) break;
            vec3 pos = ro + t * rd;
            vec2 mpv = mapClouds(pos);
            float den = clamp(mpv.x - 0.3, 0.0, 1.0) * 1.12;
            if (mpv.x > 0.6) {
                vec4 col = vec4(sin(vec3(5.0, 0.4, 0.2) + mpv.y * 0.1 + sin(pos.z * 0.4) * 0.5 + 1.8) * 0.5 + 0.5, 0.08);
                col.rgb *= linstep(4.0, -2.5, mpv.x) * 2.3;
                rez = rez + col * den * (1.0 - rez.a);
            }
            t += clamp(0.5 - mpv.x * mpv.x * 0.05, 0.09, 0.3);
        }
        rez = clamp(rez, 0.0, 1.0);
        vec4 orig = texture2D(u_texture, v_uv);
        gl_FragColor = mix(orig, rez, u_intensity);
    }
  `,

    // Cloud overlay — 2D FBM wisps inspired by iq's noise techniques
    // Renders as a proper post-process overlay (not a standalone volumetric scene)

    stClouds: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_bass;
    uniform float u_energy;
    uniform float u_intensity;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
        for (int i = 0; i < 6; i++) {
            v += a * noise(p);
            p = rot * p * 2.0 + 0.5;
            a *= 0.5;
        }
        return v;
    }
    void main() {
        vec2 uv = v_uv;
        float ar = u_resolution.x / u_resolution.y;
        vec2 p = (uv - 0.5) * vec2(ar, 1.0) * 3.0;
        float t = u_time * 0.15;

        // Layered cloud wisps with drift
        float f1 = fbm(p + vec2(t, t * 0.7) + u_bass * 0.5);
        float f2 = fbm(p * 1.5 + vec2(-t * 0.8, t * 0.5) + f1 * 1.5);
        float f3 = fbm(p * 0.8 + vec2(t * 0.3, -t * 0.6) + f2 * 1.2);

        // Combine into cloud density
        float cloud = f1 * 0.3 + f2 * 0.4 + f3 * 0.3;
        cloud = smoothstep(0.3, 0.8, cloud);
        cloud *= (1.0 + u_energy * 0.5);

        // Color the clouds — nebula-like palette
        vec3 col1 = vec3(0.6, 0.3, 0.8); // purple
        vec3 col2 = vec3(0.2, 0.5, 1.0); // blue
        vec3 col3 = vec3(0.9, 0.4, 0.3); // warm
        vec3 cloudColor = mix(col1, col2, f2);
        cloudColor = mix(cloudColor, col3, f3 * 0.5);
        cloudColor *= 0.8 + 0.4 * cloud;

        vec4 orig = texture2D(u_texture, uv);
        vec3 result = mix(orig.rgb, orig.rgb + cloudColor * cloud, u_intensity);
        gl_FragColor = vec4(result, orig.a);
    }
  `,

    // Film grain — classic Shadertoy post-processing effect
    stFilmGrain: `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform float u_intensity;

    void main() {
        vec4 orig = texture2D(u_texture, v_uv);
        float strength = 16.0;
        float x = (v_uv.x + 4.0) * (v_uv.y + 4.0) * (u_time * 10.0);
        float grain = (mod((mod(x, 13.0) + 1.0) * (mod(x, 123.0) + 1.0), 0.01) - 0.005) * strength;
        vec3 col = orig.rgb + vec3(grain) * u_intensity;
        // Vignette
        col *= pow(16.0 * v_uv.x * v_uv.y * (1.0 - v_uv.x) * (1.0 - v_uv.y), 0.1 * u_intensity);
        gl_FragColor = vec4(col, orig.a);
    }
  `
};

// ── Shadertoy Compatibility Shim ──────────────────────────────────────────────

const SHADERTOY_SHIM_PREFIX = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass;
uniform float u_mid;
uniform float u_treble;
uniform float u_energy;
uniform float u_beat;
uniform float u_intensity;

// Shadertoy compatibility
#define iResolution vec3(u_resolution, 1.0)
#define iTime u_time
#define iTimeDelta 0.016
#define iFrame 0
#define iMouse vec4(0.0)
#define iChannel0 u_texture
#define iChannelResolution vec4[4](vec4(u_resolution, 1.0, 1.0), vec4(0.0), vec4(0.0), vec4(0.0))
#define iDate vec4(0.0)
#define iSampleRate 44100.0

// Audio reactivity available as custom uniforms in pasted shaders:
//   u_bass, u_mid, u_treble, u_energy, u_beat, u_intensity

`;

const SHADERTOY_SHIM_SUFFIX = `

void main() {
    vec4 col;
    mainImage(col, v_uv * u_resolution);
    vec4 orig = texture2D(u_texture, v_uv);
    gl_FragColor = mix(orig, col, u_intensity);
}
`;

function wrapShadertoyCode(source) {
    return SHADERTOY_SHIM_PREFIX + source + SHADERTOY_SHIM_SUFFIX;
}

// ── Blend Mode Enum ───────────────────────────────────────────────────────────

const BLEND_MODES = ['normal', 'screen', 'overlay', 'add', 'multiply'];

function blendModeIndex(name) {
    const idx = BLEND_MODES.indexOf(name);
    return idx >= 0 ? idx : 0;
}

// ── WebGL Helpers ─────────────────────────────────────────────────────────────

function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const err = gl.getShaderInfoLog(shader);
        console.error('[ShaderFX] Compile error:', err);
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(fragSrc) {
    const vert = compileShader(gl.VERTEX_SHADER, VERT_SRC);
    const frag = compileShader(gl.FRAGMENT_SHADER, fragSrc);
    if (!vert || !frag) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('[ShaderFX] Link error:', gl.getProgramInfoLog(prog));
        gl.deleteProgram(prog);
        return null;
    }

    // Cache uniform locations
    prog._a_position = gl.getAttribLocation(prog, 'a_position');
    prog._u_texture = gl.getUniformLocation(prog, 'u_texture');
    prog._u_time = gl.getUniformLocation(prog, 'u_time');
    prog._u_resolution = gl.getUniformLocation(prog, 'u_resolution');
    prog._u_bass = gl.getUniformLocation(prog, 'u_bass');
    prog._u_mid = gl.getUniformLocation(prog, 'u_mid');
    prog._u_treble = gl.getUniformLocation(prog, 'u_treble');
    prog._u_energy = gl.getUniformLocation(prog, 'u_energy');
    prog._u_beat = gl.getUniformLocation(prog, 'u_beat');
    prog._u_intensity = gl.getUniformLocation(prog, 'u_intensity');

    return prog;
}

function getProgram(presetName) {
    if (!programs[presetName]) {
        const src = PRESETS[presetName] || customShaders[presetName];
        if (!src) return null;
        programs[presetName] = createProgram(src);
    }
    return programs[presetName];
}

// ── Framebuffer Management ────────────────────────────────────────────────────

function createFBO() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex };
}

function ensureFBOs(w, h) {
    if (fboWidth === w && fboHeight === h) return;

    // Create or resize FBOs (A, B for ping-pong, C for temp effect pass)
    if (!fboA) {
        const a = createFBO();
        fboA = a.fbo; fboTexA = a.tex;
        const b = createFBO();
        fboB = b.fbo; fboTexB = b.tex;
        const c = createFBO();
        fboC = c.fbo; fboTexC = c.tex;
    }

    // Resize all three
    [fboTexA, fboTexB, fboTexC].forEach(tex => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    });

    fboWidth = w;
    fboHeight = h;
}

function drawQuad(prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.enableVertexAttribArray(prog._a_position);
    gl.vertexAttribPointer(prog._a_position, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function setCommonUniforms(prog, t, af, layerIntensity) {
    gl.uniform1i(prog._u_texture, 0);
    gl.uniform1f(prog._u_time, t);
    gl.uniform2f(prog._u_resolution, fboWidth, fboHeight);
    gl.uniform1f(prog._u_bass, af.bass || 0);
    gl.uniform1f(prog._u_mid, af.mid || 0);
    gl.uniform1f(prog._u_treble, af.treble || 0);
    gl.uniform1f(prog._u_energy, af.energy || 0);
    gl.uniform1f(prog._u_beat, af.beat ? 1.0 : 0.0);
    gl.uniform1f(prog._u_intensity, layerIntensity);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getShaderPresetNames() {
    return Object.keys(PRESETS);
}

export function getCustomShaderNames() {
    return Object.keys(customShaders);
}

export function getAllShaderNames() {
    return [...Object.keys(PRESETS), ...Object.keys(customShaders)];
}

export function getBlendModes() {
    return [...BLEND_MODES];
}

export function getMaxLayers() {
    return MAX_LAYERS;
}

export function getLayers() {
    return layers.map(l => ({ ...l }));
}

export function initShaderFX(p5Canvas) {
    if (glCanvas) return;

    glCanvas = document.createElement('canvas');
    glCanvas.id = 'shader-fx-canvas';
    glCanvas.style.position = 'absolute';
    glCanvas.style.top = '0';
    glCanvas.style.left = '0';
    glCanvas.style.pointerEvents = 'none';
    glCanvas.style.display = 'none';

    p5Canvas.parentNode.appendChild(glCanvas);

    gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!gl) {
        console.error('[ShaderFX] WebGL not available');
        return;
    }

    // Quad buffer
    const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // Source texture
    sourceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Blend composite program
    blendProgram = createProgram(BLEND_FRAG);
    if (blendProgram) {
        blendProgram._u_base = gl.getUniformLocation(blendProgram, 'u_base');
        blendProgram._u_layer = gl.getUniformLocation(blendProgram, 'u_layer');
        blendProgram._u_intensity = gl.getUniformLocation(blendProgram, 'u_intensity');
        blendProgram._u_blendMode = gl.getUniformLocation(blendProgram, 'u_blendMode');
    }

    startTime = performance.now();

    // Restore custom shaders from localStorage
    loadCustomShadersFromStorage();
}

// ── Layer Management ──────────────────────────────────────────────────────────

export function addLayer(preset, intensity, blendMode) {
    if (layers.length >= MAX_LAYERS) return -1;
    layers.push({
        preset: preset || 'off',
        intensity: intensity != null ? intensity : 0.5,
        blendMode: blendMode || 'normal'
    });
    _updateVisibility();
    return layers.length - 1;
}

export function removeLayer(index) {
    if (index >= 0 && index < layers.length) {
        layers.splice(index, 1);
        _updateVisibility();
    }
}

export function setLayerPreset(index, preset) {
    if (layers[index]) {
        layers[index].preset = preset;
        _updateVisibility();
    }
}

export function setLayerIntensity(index, val) {
    if (layers[index]) {
        layers[index].intensity = Math.max(0, Math.min(1, val));
    }
}

export function setLayerBlendMode(index, mode) {
    if (layers[index]) {
        layers[index].blendMode = mode;
    }
}

function _updateVisibility() {
    if (!glCanvas) return;
    const hasActive = layers.some(l => l.preset && l.preset !== 'off');
    glCanvas.style.display = hasActive ? '' : 'none';
}

// ── Backwards compat (single preset mode still works) ─────────────────────────

export function setShaderPreset(name) {
    // Legacy single-preset API: sets layer 0
    if (layers.length === 0) {
        addLayer(name, 0.5, 'normal');
    } else {
        layers[0].preset = (name === 'off' || !name) ? 'off' : name;
    }
    _updateVisibility();
}

export function setShaderIntensity(val) {
    if (layers.length > 0) {
        layers[0].intensity = Math.max(0, Math.min(1, val));
    }
}

// ── Shadertoy Import ──────────────────────────────────────────────────────────

export function importShadertoyGLSL(source, name) {
    // Detect if it's a Shadertoy shader (has mainImage)
    const isShadertoy = /void\s+mainImage\s*\(/.test(source);
    const finalSrc = isShadertoy ? wrapShadertoyCode(source) : source;

    // Store and pre-compile
    customShaders[name] = finalSrc;
    // Clear cached program so it recompiles
    if (programs[name]) {
        gl.deleteProgram(programs[name]);
        delete programs[name];
    }

    // Test compile
    const prog = getProgram(name);
    if (!prog) {
        delete customShaders[name];
        return { success: false, error: 'Shader compilation failed — check console for details' };
    }
    saveCustomShadersToStorage();
    return { success: true, name };
}

export function removeCustomShader(name) {
    if (programs[name]) {
        gl.deleteProgram(programs[name]);
        delete programs[name];
    }
    delete customShaders[name];
    saveCustomShadersToStorage();
    // Remove from any layers using it
    layers.forEach(l => {
        if (l.preset === name) l.preset = 'off';
    });
    _updateVisibility();
}

// ── Render Pipeline ───────────────────────────────────────────────────────────

export function renderShaderFX(p5Canvas, audioFeatures) {
    if (!gl || !glCanvas) return;

    const activeLayers = layers.filter(l => l.preset && l.preset !== 'off');
    if (activeLayers.length === 0) return;

    const w = p5Canvas.width;
    const h = p5Canvas.height;

    // Match canvas size
    if (glCanvas.width !== w || glCanvas.height !== h) {
        glCanvas.width = w;
        glCanvas.height = h;
        glCanvas.style.width = p5Canvas.style.width || `${w}px`;
        glCanvas.style.height = p5Canvas.style.height || `${h}px`;
    }

    gl.viewport(0, 0, w, h);

    const t = (performance.now() - startTime) / 1000;
    const af = audioFeatures || {};

    // Upload source canvas
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, p5Canvas);

    // Single layer fast path — render directly to screen
    if (activeLayers.length === 1) {
        const layer = activeLayers[0];
        const prog = getProgram(layer.preset);
        if (!prog) {
            // Shader failed — hide overlay so fractal stays visible
            glCanvas.style.display = 'none';
            return;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.useProgram(prog);
        setCommonUniforms(prog, t, af, layer.intensity);
        drawQuad(prog);
        return;
    }

    // Multi-layer: use ping-pong FBOs
    // A/B = ping-pong for accumulated results, C = temp for effect passes
    ensureFBOs(w, h);

    // Read starts from sourceTexture
    // Write alternates between fboA and fboB
    // fboC is always used for temporary effect renders
    let readTex = sourceTexture;
    let writeFBO = fboA;
    let writeTex = fboTexA;

    for (let i = 0; i < activeLayers.length; i++) {
        const layer = activeLayers[i];
        const prog = getProgram(layer.preset);
        if (!prog) continue;

        const isLast = (i === activeLayers.length - 1);
        const outputFBO = isLast ? null : writeFBO;  // null = screen

        if (i === 0) {
            // First layer: apply effect directly from source → output
            gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
            gl.useProgram(prog);
            setCommonUniforms(prog, t, af, layer.intensity);
            drawQuad(prog);
        } else {
            // Step 1: Render effect from readTex → fboC (temp)
            // fboC is never used as readTex, so no feedback loop
            gl.bindFramebuffer(gl.FRAMEBUFFER, fboC);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, readTex);
            gl.useProgram(prog);
            setCommonUniforms(prog, t, af, 1.0);  // full effect, blend handles mix
            drawQuad(prog);

            // Step 2: Blend readTex (base) + fboTexC (effect) → output
            gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.useProgram(blendProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, readTex);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, fboTexC);
            gl.uniform1i(blendProgram._u_base, 0);
            gl.uniform1i(blendProgram._u_layer, 1);
            gl.uniform1f(blendProgram._u_intensity, layer.intensity);
            gl.uniform1i(blendProgram._u_blendMode, blendModeIndex(layer.blendMode));
            drawQuad(blendProgram);
        }

        // Advance ping-pong: what we just wrote becomes the next read
        if (!isLast) {
            readTex = writeTex;
            // Swap write target to the other FBO
            if (writeFBO === fboA) {
                writeFBO = fboB;
                writeTex = fboTexB;
            } else {
                writeFBO = fboA;
                writeTex = fboTexA;
            }
        }
    }
}

export function destroyShaderFX() {
    if (glCanvas && glCanvas.parentNode) {
        glCanvas.parentNode.removeChild(glCanvas);
    }
    glCanvas = null;
    gl = null;
    programs = {};
    sourceTexture = null;
    layers = [];
    fboA = fboB = fboC = fboTexA = fboTexB = fboTexC = null;
    fboWidth = fboHeight = 0;
    blendProgram = null;
}
