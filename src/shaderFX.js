/**
 * ShaderFX — WebGL post-processing visual presets.
 *
 * Creates a WebGL canvas overlay on top of the p5 canvas, uploading the fractal
 * as a texture and running GLSL fragment shaders against it.
 *
 * All presets are audio-reactive via uniforms:
 *   u_time, u_resolution, u_bass, u_mid, u_treble, u_energy, u_beat, u_intensity
 */

// ── State ─────────────────────────────────────────────────────────────────────

let gl = null;
let glCanvas = null;
let programs = {};       // cached compiled programs keyed by preset name
let quadVAO = null;
let quadVBO = null;
let sourceTexture = null;
let currentPreset = null;
let intensity = 0.5;
let startTime = 0;

// ── Vertex Shader (shared by all presets) ─────────────────────────────────────

const VERT_SRC = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
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
    uniform vec2 u_resolution;
    uniform float u_bass;
    uniform float u_energy;
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
        // Radial glow
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
        // Center sample within block
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

        // Sobel edge detection
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

        // Neon glow coloring
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
        // Boost saturation slightly
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

        // Block displacement
        float blockY = floor(uv.y * 20.0) / 20.0;
        float noise = rand(vec2(blockY, floor(u_time * 8.0)));
        if (noise > 1.0 - glitchAmount * 0.3) {
            uv.x += (rand(vec2(blockY, u_time)) - 0.5) * glitchAmount * 0.15;
        }

        // Scan line jitter
        if (rand(vec2(u_time * 3.0, uv.y * 100.0)) > 1.0 - glitchAmount * 0.1) {
            uv.x += (rand(vec2(uv.y, u_time * 5.0)) - 0.5) * 0.02 * glitchAmount;
        }

        // Channel separation on glitch frames
        float r = texture2D(u_texture, uv + vec2(glitchAmount * 0.01, 0.0)).r;
        float g = texture2D(u_texture, uv).g;
        float b = texture2D(u_texture, uv - vec2(glitchAmount * 0.01, 0.0)).b;

        vec4 orig = texture2D(u_texture, v_uv);
        vec4 glitched = vec4(r, g, b, 1.0);
        gl_FragColor = mix(orig, glitched, min(1.0, u_intensity));
    }
  `
};

// ── WebGL Helpers ─────────────────────────────────────────────────────────────

function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[ShaderFX] Compile error:', gl.getShaderInfoLog(shader));
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

    // Cache attribute/uniform locations
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
        const src = PRESETS[presetName];
        if (!src) return null;
        programs[presetName] = createProgram(src);
    }
    return programs[presetName];
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getShaderPresetNames() {
    return Object.keys(PRESETS);
}

export function initShaderFX(p5Canvas) {
    if (glCanvas) return; // already initialized

    glCanvas = document.createElement('canvas');
    glCanvas.id = 'shader-fx-canvas';
    glCanvas.style.position = 'absolute';
    glCanvas.style.top = '0';
    glCanvas.style.left = '0';
    glCanvas.style.pointerEvents = 'none';
    glCanvas.style.display = 'none';

    // Insert right after p5 canvas
    p5Canvas.parentNode.appendChild(glCanvas);

    gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!gl) {
        console.error('[ShaderFX] WebGL not available');
        return;
    }

    // Full-screen quad
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

    startTime = performance.now();
}

export function setShaderPreset(name) {
    if (name === 'off' || !name) {
        currentPreset = null;
        if (glCanvas) glCanvas.style.display = 'none';
    } else if (PRESETS[name]) {
        currentPreset = name;
        if (glCanvas) glCanvas.style.display = '';
    }
}

export function setShaderIntensity(val) {
    intensity = Math.max(0, Math.min(1, val));
}

export function renderShaderFX(p5Canvas, audioFeatures) {
    if (!currentPreset || !gl || !glCanvas) return;

    const prog = getProgram(currentPreset);
    if (!prog) return;

    // Match canvas size
    const w = p5Canvas.width;
    const h = p5Canvas.height;
    if (glCanvas.width !== w || glCanvas.height !== h) {
        glCanvas.width = w;
        glCanvas.height = h;
        glCanvas.style.width = p5Canvas.style.width || `${w}px`;
        glCanvas.style.height = p5Canvas.style.height || `${h}px`;
    }

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Upload fractal canvas as texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, p5Canvas);

    gl.useProgram(prog);

    // Uniforms
    const t = (performance.now() - startTime) / 1000;
    const af = audioFeatures || {};

    gl.uniform1i(prog._u_texture, 0);
    gl.uniform1f(prog._u_time, t);
    gl.uniform2f(prog._u_resolution, w, h);
    gl.uniform1f(prog._u_bass, af.bass || 0);
    gl.uniform1f(prog._u_mid, af.mid || 0);
    gl.uniform1f(prog._u_treble, af.treble || 0);
    gl.uniform1f(prog._u_energy, af.energy || 0);
    gl.uniform1f(prog._u_beat, af.beat ? 1.0 : 0.0);
    gl.uniform1f(prog._u_intensity, intensity);

    // Draw quad
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.enableVertexAttribArray(prog._a_position);
    gl.vertexAttribPointer(prog._a_position, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function destroyShaderFX() {
    if (glCanvas && glCanvas.parentNode) {
        glCanvas.parentNode.removeChild(glCanvas);
    }
    glCanvas = null;
    gl = null;
    programs = {};
    sourceTexture = null;
    currentPreset = null;
}
