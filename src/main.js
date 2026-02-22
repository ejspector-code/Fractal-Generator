/**
 * Main entry point — p5.js instance mode sketch
 * Supports Peter de Jong, Clifford, Lorenz, Aizawa, Buddhabrot, Burning Ship, and Curl Noise.
 */
import p5 from 'p5';
import './styles.css';
import { renderClassic, renderParticles, renderVapor, resetParticles, initClickBurst, renderClickBursts } from './renderer.js';
import { Animator } from './animator.js';
import { DEJONG_PRESETS, CLIFFORD_PRESETS, LORENZ_PRESETS, AIZAWA_PRESETS, BUDDHABROT_PRESETS, BURNINGSHIP_PRESETS, CURLNOISE_PRESETS, MANDELBROT_PRESETS } from './presets.js';
import { initUI } from './ui.js';
import { savePNG, startRecording, stopRecording, isRecording } from './exporter.js';
import { startAudio, stopAudio, getFrequencyData, getTimeDomainData, isActive as isAudioActive, getSampleRate, getBinCount } from './audio.js';
import { analyzeFrame, resetAnalysis } from './audioReactive.js';
import { perturbCoeffs } from './mouseInteraction.js';
import { applyPostProcessing } from './postProcess.js';
import { applySymmetry } from './symmetry.js';
import { startMidi, stopMidi, isMidiActive, getMidiFrequencyData, getMidiTimeDomainData, getMidiSampleRate, getMidiBinCount, setMidiWaveform, getMidiActiveNotes, getMidiDevices, setNoteCallback, noteOn, noteOff, setFilterCutoff, setFilterQ, setFilterType, setDistortionDrive, setWahEnabled, setWahRate, setWahDepth, setWahBaseFreq, setDelayTime, setDelayFeedback, setDelayMix, setReverbMix, setReverbDecay, setADSR, setMasterVolume, setOctaveShift, setScaleLock, setScaleRoot, setScaleType, setChordEnabled, setChordType, setArpEnabled, setArpPattern, setArpRate, setArpBPM, setArpOctaves, getAudioStream, startLooperRecording, stopLooperRecording, toggleLooperPlayback, stopLooper, getLooperState, setLooperCallback, startDrumSequencer, stopDrumSequencer, toggleDrumStep, setDrumBPM, setDrumVolume, clearDrumPattern, isDrumPlaying, setDrumStepCallback, getDrumTrackNames, getDrumStepCount, setDrumSwing, setDrumStepCount, setDrumMute, setDrumSolo, loadDrumPreset, getDrumPattern, setGlobalBPM, getGlobalBPM, setTempoChangeCallback, loadSynthPreset, getSynthPresetNames, getEffectParams, getMidiAudioContext, getMidiMasterGain } from './midi.js';
import { drawWaveform } from './waveformOverlay.js';
import { playClickPerc } from './clickSound.js';
import {
  startGuitar, stopGuitar, isGuitarActive, pluckString, strumChord,
  getGuitarFrequencyData, getGuitarTimeDomainData, getGuitarSampleRate, getGuitarBinCount,
  getStringStates, getCurrentTuningInfo, setGuitarTuning, setGuitarChord, setGuitarVolume,
  setPluckCallback, getCurrentChord, getChordShape,
  playRiff, stopRiff, isRiffPlaying, setCurrentRiff,
  togglePedal, setPedalParam, setRiffBPM
} from './guitar.js';
import {
  initBass, destroyBass, isBassActive, bassNoteOn, bassNoteOff,
  setBassWaveform, setBassSubWave, setBassSubLevel,
  setBassCutoff, setBassResonance, setBassEnvAmount, setBassEnvDecay,
  setBassGlide, setBassOctave, setBassVolume, setBassAccent
} from './bass.js';
import {
  initShaderFX, renderShaderFX, destroyShaderFX,
  getShaderPresetNames, getCustomShaderNames, getAllShaderNames, getBlendModes, getMaxLayers,
  addLayer, removeLayer, setLayerPreset, setLayerIntensity, setLayerBlendMode,
  getLayers, importShadertoyGLSL, removeCustomShader
} from './shaderFX.js';


// ── Shared State ──────────────────────────────────────────────────────────────

const state = {
  seed: 12345,
  attractorType: 'dejong', // 'dejong' | 'clifford' | 'lorenz' | 'aizawa' | 'buddhabrot' | 'burningship' | 'mandelbrot' | 'curlnoise'

  // De Jong coefficients
  coeffs: { a: DEJONG_PRESETS[0].a, b: DEJONG_PRESETS[0].b, c: DEJONG_PRESETS[0].c, d: DEJONG_PRESETS[0].d },

  // Clifford coefficients
  cliffordCoeffs: { a: CLIFFORD_PRESETS[0].a, b: CLIFFORD_PRESETS[0].b, c: CLIFFORD_PRESETS[0].c, d: CLIFFORD_PRESETS[0].d },

  // Lorenz coefficients
  lorenzCoeffs: { sigma: LORENZ_PRESETS[0].sigma, rho: LORENZ_PRESETS[0].rho, beta: LORENZ_PRESETS[0].beta },

  // Aizawa coefficients
  aizawaCoeffs: { a: AIZAWA_PRESETS[0].a, b: AIZAWA_PRESETS[0].b, c: AIZAWA_PRESETS[0].c, d: AIZAWA_PRESETS[0].d, e: AIZAWA_PRESETS[0].e, f: AIZAWA_PRESETS[0].f },

  // Buddhabrot parameters
  buddhabrotParams: { ...BUDDHABROT_PRESETS[0] },

  // Burning Ship parameters
  burningShipParams: { ...BURNINGSHIP_PRESETS[0] },

  // Curl Noise parameters
  curlNoiseParams: { ...CURLNOISE_PRESETS[0] },

  // Mandelbrot / Julia parameters
  mandelbrotParams: { ...MANDELBROT_PRESETS[0] },

  renderMode: 'classic', // 'classic' | 'particles' | 'vapor'

  classicParams: {
    iterationsPow: 5.7, // 10^5.7 ≈ 500K
    densityMode: 'sqrt',
  },

  particleParams: {
    count: 2000,
    trail: 0.92,
    glow: 1.5,
    size: 2.0,
  },

  vaporParams: {
    count: 3000,
    blurPasses: 3,
    turbulence: 0.4,
    dissipation: 0.96,
  },

  colorParams: {
    mode: 'spectral', // 'single' | 'dual' | 'spectral' | 'vivid'
    colorA: '#00d4ff',
    colorB: '#ff006e',
    blendMode: 'normal', // 'normal' | 'add'
  },

  bgColor: '#0a0a0f',

  aspectRatio: '16:9', // '1:1' | '16:9' | '9:16'

  diffusion: {
    enabled: false,
    strength: 1.5,
  },

  // Audio reactive
  audioSensitivity: 1.0,
  audioFeatures: null, // { bass, mid, treble, energy, beat } or null
  timeDomainData: null, // Uint8Array waveform for renderer displacement

  // Waveform overlay
  waveformOverlay: {
    enabled: false,
    intensity: 0.7,
    style: 'oscilloscope', // 'oscilloscope' | 'mirrored' | 'circular' | 'bars' | 'radial'
  },

  // Mouse interaction
  mouse: {
    enabled: false,
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    overCanvas: false,
    strength: 0.5,
    mode: 'attract', // 'attract' | 'repel' | 'orbit'
  },

  // Symmetry / Kaleidoscope
  symmetry: {
    folds: 1, // 1 = off, 2/4/6/8
  },

  // Post-processing filters
  postProcess: {
    bloom: { enabled: false, strength: 0.5 },
    chromatic: { enabled: false, strength: 0.5 },
    vignette: { enabled: false, strength: 0.5 },
    grain: { enabled: false, strength: 0.3 },
    scanlines: { enabled: false, strength: 0.4 },
  },

  needsRedraw: true,
};

// ── Helper: get the animator base for current attractor type ──────────────────

function getAnimatorBase(type) {
  switch (type) {
    case 'lorenz': return state.lorenzCoeffs;
    case 'aizawa': return state.aizawaCoeffs;
    case 'clifford': return state.cliffordCoeffs;
    case 'curlnoise': return { ...state.curlNoiseParams };
    case 'buddhabrot': {
      const { maxIter, zoom, centerX, centerY } = state.buddhabrotParams;
      return { maxIter, zoom, centerX, centerY };
    }
    case 'burningship': {
      const { maxIter, zoom, centerX, centerY } = state.burningShipParams;
      return { maxIter, zoom, centerX, centerY };
    }
    case 'mandelbrot': {
      const { maxIter, zoom, centerX, centerY, julia, juliaR, juliaI } = state.mandelbrotParams;
      return { maxIter, zoom, centerX, centerY, julia, juliaR, juliaI };
    }
    default: return state.coeffs;
  }
}

// Sync functions map (filled after UI init)
const syncMap = {};

function syncCurrentSliders() {
  switch (state.attractorType) {
    case 'lorenz': if (syncMap.syncLorenzSliders) syncMap.syncLorenzSliders(); break;
    case 'aizawa': if (syncMap.syncAizawaSliders) syncMap.syncAizawaSliders(); break;
    case 'clifford': if (syncMap.syncCliffordSliders) syncMap.syncCliffordSliders(); break;
    case 'buddhabrot': if (syncMap.syncBuddhabrotSliders) syncMap.syncBuddhabrotSliders(); break;
    case 'burningship': if (syncMap.syncBurningShipSliders) syncMap.syncBurningShipSliders(); break;
    case 'curlnoise': if (syncMap.syncCurlNoiseSliders) syncMap.syncCurlNoiseSliders(); break;
    default: if (syncMap.syncCoeffSliders) syncMap.syncCoeffSliders(); break;
  }
}

function applyAnimCoeffs(animCoeffs) {
  switch (state.attractorType) {
    case 'lorenz':
      state.lorenzCoeffs.sigma = animCoeffs.sigma;
      state.lorenzCoeffs.rho = animCoeffs.rho;
      state.lorenzCoeffs.beta = animCoeffs.beta;
      break;
    case 'aizawa':
      ['a', 'b', 'c', 'd', 'e', 'f'].forEach(k => {
        if (animCoeffs[k] !== undefined) state.aizawaCoeffs[k] = animCoeffs[k];
      });
      break;
    case 'clifford':
      ['a', 'b', 'c', 'd'].forEach(k => {
        if (animCoeffs[k] !== undefined) state.cliffordCoeffs[k] = animCoeffs[k];
      });
      break;
    case 'buddhabrot':
      Object.keys(animCoeffs).forEach(k => {
        if (k === 'maxIter') state.buddhabrotParams[k] = Math.round(animCoeffs[k]);
        else state.buddhabrotParams[k] = animCoeffs[k];
      });
      break;
    case 'burningship':
      Object.keys(animCoeffs).forEach(k => {
        if (k === 'maxIter') state.burningShipParams[k] = Math.round(animCoeffs[k]);
        else state.burningShipParams[k] = animCoeffs[k];
      });
      break;
    case 'mandelbrot':
      Object.keys(animCoeffs).forEach(k => {
        if (k === 'maxIter') state.mandelbrotParams[k] = Math.round(animCoeffs[k]);
        else state.mandelbrotParams[k] = animCoeffs[k];
      });
      break;
    case 'curlnoise':
      Object.keys(animCoeffs).forEach(k => {
        if (animCoeffs[k] !== undefined) state.curlNoiseParams[k] = animCoeffs[k];
      });
      break;
    default:
      state.coeffs.a = animCoeffs.a;
      state.coeffs.b = animCoeffs.b;
      state.coeffs.c = animCoeffs.c;
      state.coeffs.d = animCoeffs.d;
      break;
  }
}

// ── Animator ──────────────────────────────────────────────────────────────────

const animator = new Animator();
animator.setBase(state.coeffs);

// ── p5.js Sketch ──────────────────────────────────────────────────────────────

// ── Canvas dimension helper ──────────────────────────────────────────────────

function computeCanvasDims(ratio, maxW, maxH) {
  let w, h;
  switch (ratio) {
    case '16:9': {
      w = maxW;
      h = Math.round(w * 9 / 16);
      if (h > maxH) { h = maxH; w = Math.round(h * 16 / 9); }
      break;
    }
    case '9:16': {
      h = Math.min(maxH, maxW * 16 / 9);
      w = Math.round(h * 9 / 16);
      if (w > maxW) { w = maxW; h = Math.round(w * 16 / 9); }
      break;
    }
    default: { // 1:1
      w = maxW;
      h = w;
      if (h > maxH) { h = maxH; w = h; }
      break;
    }
  }
  w = Math.max(w, 200);
  h = Math.max(h, 200);
  return { w, h };
}

const sketch = (p) => {
  let fpsFrames = 0;
  let fpsLast = 0;

  p.setup = () => {
    const container = document.getElementById('canvas-container');
    const area = document.getElementById('canvas-area');
    const { w, h } = computeCanvasDims(state.aspectRatio, area.clientWidth, area.clientHeight - 40);

    const cnv = p.createCanvas(w, h);
    cnv.parent(container);

    p.pixelDensity(1);
    p.randomSeed(state.seed);
    p.noiseSeed(state.seed);

    // Background fill
    const bg = hexToRgbSimple(state.bgColor);
    p.background(bg.r, bg.g, bg.b);

    // Init shader FX overlay
    initShaderFX(p.drawingContext.canvas);
  };

  p.draw = () => {
    // FPS counter
    fpsFrames++;
    const now = p.millis();
    if (now - fpsLast > 500) {
      const fps = Math.round(fpsFrames / ((now - fpsLast) / 1000));
      document.getElementById('fps-counter').textContent = `${fps} FPS`;
      fpsFrames = 0;
      fpsLast = now;
    }

    // ── Mouse Tracking ────────────────────────────────────────────────────
    if (state.mouse.enabled) {
      const mx = p.mouseX;
      const my = p.mouseY;
      const over = mx >= 0 && mx < p.width && my >= 0 && my < p.height;
      state.mouse.overCanvas = over;
      if (over) {
        state.mouse.screenX = mx;
        state.mouse.screenY = my;
        state.mouse.x = mx / p.width;
        state.mouse.y = my / p.height;
        // In classic mode, mouse movement triggers redraw
        if (state.renderMode === 'classic') {
          state.needsRedraw = true;
        }
      }
    }

    // ── Audio Analysis (Mic, MIDI, and/or Guitar — all can run simultaneously) ──
    let currentTimeDomain = null;
    let hasAudioSource = false;

    if (isMidiActive()) {
      const freqData = getMidiFrequencyData();
      if (freqData) {
        const features = analyzeFrame(freqData, getMidiSampleRate(), getMidiBinCount(), state.audioSensitivity);
        animator.setAudioModulation(features);
        state.audioFeatures = features;
        drawAudioVisualizer(freqData);
        drawMidiKeyboard();
        currentTimeDomain = getMidiTimeDomainData();
        hasAudioSource = true;
      }
    }

    if (isGuitarActive()) {
      const guitarFreq = getGuitarFrequencyData();
      if (guitarFreq) {
        // If no MIDI, use guitar as the primary audio source for reactive features
        if (!hasAudioSource) {
          const features = analyzeFrame(guitarFreq, getGuitarSampleRate(), getGuitarBinCount(), state.audioSensitivity);
          animator.setAudioModulation(features);
          state.audioFeatures = features;
          drawAudioVisualizer(guitarFreq);
          currentTimeDomain = getGuitarTimeDomainData();
        }
        drawGuitarFretboard();
        hasAudioSource = true;
      }
    }

    if (!hasAudioSource && isAudioActive()) {
      const freqData = getFrequencyData();
      if (freqData) {
        const features = analyzeFrame(freqData, getSampleRate(), getBinCount(), state.audioSensitivity);
        animator.setAudioModulation(features);
        state.audioFeatures = features;
        drawAudioVisualizer(freqData);
        currentTimeDomain = getTimeDomainData();
        hasAudioSource = true;
      }
    }

    if (!hasAudioSource) {
      state.audioFeatures = null;
    }

    // Store time-domain data on state for renderer access
    state.timeDomainData = currentTimeDomain;

    // Animation update
    const animCoeffs = animator.update();
    if (animCoeffs) {
      applyAnimCoeffs(animCoeffs);
      syncCurrentSliders();
      state.needsRedraw = true;
    }
    // Pass animator's color shift to renderers
    state.audioColorShift = animator.colorShift || 0;

    // Force redraw every frame when waveform overlay or audio effects are active
    if ((state.waveformOverlay.enabled && currentTimeDomain) || state.audioFeatures) {
      state.needsRedraw = true;
    }

    // For animated modes, always redraw
    let didRender = false;
    if (state.renderMode === 'particles' || state.renderMode === 'vapor') {
      switch (state.renderMode) {
        case 'particles':
          renderParticles(p, state, p.frameCount);
          break;
        case 'vapor':
          renderVapor(p, state, p.frameCount);
          break;
      }
      didRender = true;
    } else if (state.needsRedraw) {
      // Classic mode: apply mouse perturbation if active
      if (state.mouse.enabled && state.mouse.overCanvas) {
        const perturbedState = { ...state };
        const currentCoeffs = getAnimatorBase(state.attractorType);
        const perturbed = perturbCoeffs(currentCoeffs, state.mouse.x, state.mouse.y, state.mouse.strength);
        // Apply perturbed coefficients to a temp state copy
        switch (state.attractorType) {
          case 'lorenz': perturbedState.lorenzCoeffs = perturbed; break;
          case 'aizawa': perturbedState.aizawaCoeffs = perturbed; break;
          case 'clifford': perturbedState.cliffordCoeffs = perturbed; break;
          case 'curlnoise': perturbedState.curlNoiseParams = perturbed; break;
          case 'buddhabrot': perturbedState.buddhabrotParams = { ...state.buddhabrotParams, ...perturbed }; break;
          case 'burningship': perturbedState.burningShipParams = { ...state.burningShipParams, ...perturbed }; break;
          default: perturbedState.coeffs = perturbed; break;
        }
        renderClassic(p, perturbedState);
      } else {
        renderClassic(p, state);
      }
      didRender = true;
      state.needsRedraw = false;
    }

    // ── Waveform Overlay (after fractal render) ────────────────────────────
    if (state.waveformOverlay.enabled && currentTimeDomain) {
      drawWaveform(p, currentTimeDomain, state.audioFeatures, state.colorParams, state.waveformOverlay.intensity, state.waveformOverlay.style);
    }

    // Apply symmetry / kaleidoscope only on fresh renders
    if (didRender && state.symmetry.folds > 1) {
      applySymmetry(p, state.symmetry.folds);
    }

    // Always render click bursts on top
    renderClickBursts(p);

    // Post-processing overlay (runs every frame for grain animation)
    const p5Canvas = p.drawingContext.canvas;
    applyPostProcessing(p5Canvas, state.postProcess);

    // Shader FX overlay
    renderShaderFX(p5Canvas, state.audioFeatures);
  };

  // Click burst handler (skip for fractal-explorer types — click zooms instead)
  p.mousePressed = () => {
    const mx = p.mouseX;
    const my = p.mouseY;
    if (mx >= 0 && mx < p.width && my >= 0 && my < p.height) {
      const isExplorer = ['mandelbrot', 'buddhabrot', 'burningShip'].includes(state.attractorType);

      if (isExplorer) {
        // ── Click to recenter on cursor position ──
        _mbDragStart = { x: mx, y: my };
        _mbDragging = false;
        return; // don't fire click burst
      }

      initClickBurst(mx, my, p.width, state.colorParams);

      // Play position-mapped percussion: hi-hat (top) → rimshot (mid) → kick (bottom)
      const yRatio = my / p.height;
      const xRatio = mx / p.width;
      playClickPerc(yRatio, xRatio, 0.5);

      // In classic mode, force a few redraws so the burst animates
      if (state.renderMode === 'classic') {
        state.needsRedraw = true;
        // Keep redrawing for the burst duration
        let frames = 0;
        const burstLoop = setInterval(() => {
          state.needsRedraw = true;
          frames++;
          if (frames >= 65) clearInterval(burstLoop);
        }, 16);
      }
    }
  };

  // ── Mandelbrot/Julia canvas interactions: scroll-to-zoom + drag-to-pan ──
  let _mbDragStart = null;
  let _mbDragging = false;

  /** Get the fractal params object for the active explorer type */
  function _getExplorerParams() {
    switch (state.attractorType) {
      case 'mandelbrot': return state.mandelbrotParams;
      case 'buddhabrot': return state.buddhabrotParams;
      case 'burningShip': return state.burningShipParams;
      default: return null;
    }
  }

  /** Convert pixel (px, py) to complex plane coordinates */
  function _pixelToComplex(px, py, params, w, h) {
    const aspect = w / h;
    const scale = 3.0 / params.zoom;
    const re = params.centerX + (px / w - 0.5) * scale * aspect;
    const im = params.centerY + (py / h - 0.5) * scale;
    return { re, im };
  }

  /** Sync the sidebar sliders for the active explorer type */
  function _syncExplorerSliders() {
    if (syncMap.syncMandelbrotSliders && state.attractorType === 'mandelbrot') syncMap.syncMandelbrotSliders();
    if (syncMap.syncBuddhabrotSliders && state.attractorType === 'buddhabrot') syncMap.syncBuddhabrotSliders();
    if (syncMap.syncBurningShipSliders && state.attractorType === 'burningShip') syncMap.syncBurningShipSliders();
  }

  // Scroll-to-zoom on canvas (centered on cursor position)
  const canvasContainer = document.getElementById('canvas-container');
  canvasContainer.addEventListener('wheel', (e) => {
    const params = _getExplorerParams();
    if (!params) return;

    e.preventDefault();

    const rect = canvasContainer.querySelector('canvas').getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    // Point under cursor in complex plane BEFORE zoom
    const before = _pixelToComplex(mx, my, params, w, h);

    // Zoom factor: scroll up = zoom in, scroll down = zoom out
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    params.zoom = Math.max(0.5, Math.min(100000, params.zoom * factor));

    // Point under cursor AFTER zoom (with same center)
    const after = _pixelToComplex(mx, my, params, w, h);

    // Shift center so the point under cursor stays fixed
    params.centerX += before.re - after.re;
    params.centerY += before.im - after.im;

    _syncExplorerSliders();
    state.needsRedraw = true;
  }, { passive: false });

  // Drag-to-pan on canvas
  canvasContainer.addEventListener('mousemove', (e) => {
    if (!_mbDragStart) return;
    const params = _getExplorerParams();
    if (!params) return;

    const dx = e.movementX;
    const dy = e.movementY;

    if (!_mbDragging && (Math.abs(e.clientX - _mbDragStart.x) > 3 || Math.abs(e.clientY - _mbDragStart.y) > 3)) {
      _mbDragging = true;
    }

    if (_mbDragging) {
      const rect = canvasContainer.querySelector('canvas').getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const scale = 3.0 / params.zoom;

      params.centerX -= (dx / rect.width) * scale * aspect;
      params.centerY -= (dy / rect.height) * scale;

      _syncExplorerSliders();
      state.needsRedraw = true;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (_mbDragStart && !_mbDragging) {
      // Short click (no drag) → recenter on clicked point
      const params = _getExplorerParams();
      if (params) {
        const rect = canvasContainer.querySelector('canvas').getBoundingClientRect();
        const mx = _mbDragStart.x;
        const my = _mbDragStart.y;
        const pt = _pixelToComplex(mx, my, params, rect.width, rect.height);
        params.centerX = pt.re;
        params.centerY = pt.im;
        params.zoom *= 2; // Click also zooms in 2x
        params.zoom = Math.min(100000, params.zoom);
        _syncExplorerSliders();
        state.needsRedraw = true;
      }
    }
    _mbDragStart = null;
    _mbDragging = false;
  });

  // ── Touch interactions: pinch-to-zoom + drag-to-pan ──
  let _touchStartDist = 0;
  let _touchStartZoom = 1;
  let _touchStartMid = null;
  let _touchStartCenter = null;
  let _singleTouchStart = null;

  canvasContainer.addEventListener('touchstart', (e) => {
    const params = _getExplorerParams();
    if (!params) return;
    e.preventDefault();

    if (e.touches.length === 2) {
      // Pinch-to-zoom start
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      _touchStartDist = Math.hypot(dx, dy);
      _touchStartZoom = params.zoom;
      _touchStartMid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      _touchStartCenter = { x: params.centerX, y: params.centerY };
      _singleTouchStart = null;
    } else if (e.touches.length === 1) {
      // Single-finger drag-to-pan start
      _singleTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, { passive: false });

  canvasContainer.addEventListener('touchmove', (e) => {
    const params = _getExplorerParams();
    if (!params) return;
    e.preventDefault();

    const rect = canvasContainer.querySelector('canvas').getBoundingClientRect();

    if (e.touches.length === 2 && _touchStartDist > 0) {
      // Pinch-to-zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scaleFactor = dist / _touchStartDist;

      // Compute midpoint in local canvas coords
      const midX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
      const midY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;

      // Point under midpoint BEFORE zoom (use start center/zoom)
      const aspect = rect.width / rect.height;
      const scaleBefore = 3.0 / _touchStartZoom;
      const reBefore = _touchStartCenter.x + (midX / rect.width - 0.5) * scaleBefore * aspect;
      const imBefore = _touchStartCenter.y + (midY / rect.height - 0.5) * scaleBefore;

      // New zoom
      params.zoom = Math.max(0.5, Math.min(100000, _touchStartZoom * scaleFactor));

      // Point under midpoint AFTER zoom
      const scaleAfter = 3.0 / params.zoom;
      const reAfter = _touchStartCenter.x + (midX / rect.width - 0.5) * scaleAfter * aspect;
      const imAfter = _touchStartCenter.y + (midY / rect.height - 0.5) * scaleAfter;

      // Shift center so midpoint stays fixed
      params.centerX = _touchStartCenter.x + (reBefore - reAfter);
      params.centerY = _touchStartCenter.y + (imBefore - imAfter);

      _syncExplorerSliders();
      state.needsRedraw = true;
    } else if (e.touches.length === 1 && _singleTouchStart) {
      // Single-finger drag-to-pan
      const dx = e.touches[0].clientX - _singleTouchStart.x;
      const dy = e.touches[0].clientY - _singleTouchStart.y;
      _singleTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };

      const aspect = rect.width / rect.height;
      const scale = 3.0 / params.zoom;
      params.centerX -= (dx / rect.width) * scale * aspect;
      params.centerY -= (dy / rect.height) * scale;

      _syncExplorerSliders();
      state.needsRedraw = true;
    }
  }, { passive: false });

  canvasContainer.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      _touchStartDist = 0;
      _touchStartMid = null;
      _touchStartCenter = null;
    }
    if (e.touches.length === 0) {
      _singleTouchStart = null;
    }
  });

  // Resize handling
  p.windowResized = () => {
    const area = document.getElementById('canvas-area');
    const { w, h } = computeCanvasDims(state.aspectRatio, area.clientWidth, area.clientHeight - 40);
    p.resizeCanvas(w, h);
    resetParticles();
    state.needsRedraw = true;
  };
};

function hexToRgbSimple(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// ── Audio Visualizer ──────────────────────────────────────────────────────────

let vizCanvas = null;
let vizCtx = null;

function drawAudioVisualizer(frequencyData) {
  if (!vizCanvas) {
    vizCanvas = document.getElementById('audio-visualizer');
    if (!vizCanvas) return;
    vizCtx = vizCanvas.getContext('2d');
    // Set internal resolution to match CSS display size
    vizCanvas.width = vizCanvas.offsetWidth * (window.devicePixelRatio || 1);
    vizCanvas.height = vizCanvas.offsetHeight * (window.devicePixelRatio || 1);
  }

  const w = vizCanvas.width;
  const h = vizCanvas.height;
  const ctx = vizCtx;

  ctx.clearRect(0, 0, w, h);

  // Draw ~64 bars across the canvas
  const barCount = 64;
  const step = Math.floor(frequencyData.length / barCount);
  const barWidth = w / barCount;
  const gap = 1;

  for (let i = 0; i < barCount; i++) {
    const value = frequencyData[i * step] / 255;
    const barHeight = value * h;

    // Color gradient: cyan → magenta based on frequency
    const hue = 180 + (i / barCount) * 120;
    const alpha = 0.5 + value * 0.5;

    ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${alpha})`;
    ctx.fillRect(
      i * barWidth + gap / 2,
      h - barHeight,
      barWidth - gap,
      barHeight
    );
  }
}

// ── MIDI Keyboard Visualizer ──────────────────────────────────────────────────

let midiVizCanvas = null;
let midiVizCtx = null;

function drawMidiKeyboard() {
  if (!midiVizCanvas) {
    midiVizCanvas = document.getElementById('midi-keyboard-viz');
    if (!midiVizCanvas) return;
    midiVizCtx = midiVizCanvas.getContext('2d');
  }

  // Sync internal resolution to CSS size every frame (handles resize)
  const dpr = window.devicePixelRatio || 1;
  const cssW = midiVizCanvas.offsetWidth;
  const cssH = midiVizCanvas.offsetHeight;
  if (midiVizCanvas.width !== Math.round(cssW * dpr) || midiVizCanvas.height !== Math.round(cssH * dpr)) {
    midiVizCanvas.width = Math.round(cssW * dpr);
    midiVizCanvas.height = Math.round(cssH * dpr);
    midiVizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const w = cssW;
  const h = cssH;
  const ctx = midiVizCtx;
  const activeNotes = getMidiActiveNotes();

  ctx.clearRect(0, 0, w, h);

  // Draw 2 octaves (C3=48 to B4=71), 24 notes
  const startNote = 36; // C2
  const endNote = 84;   // C6
  const totalNotes = endNote - startNote;

  // Count white keys
  const isBlack = [false, true, false, true, false, false, true, false, true, false, true, false];
  let whiteCount = 0;
  for (let n = startNote; n < endNote; n++) {
    if (!isBlack[n % 12]) whiteCount++;
  }

  const whiteWidth = w / whiteCount;
  const blackWidth = whiteWidth * 0.6;
  const blackHeight = h * 0.6;

  // Draw white keys first
  let wx = 0;
  for (let n = startNote; n < endNote; n++) {
    if (isBlack[n % 12]) continue;
    const isActive = activeNotes.has(n);

    if (isActive) {
      ctx.fillStyle = '#00d4ff';
      ctx.shadowColor = '#00d4ff';
      ctx.shadowBlur = 8;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.shadowBlur = 0;
    }

    ctx.fillRect(wx + 0.5, 0, whiteWidth - 1, h - 1);
    ctx.shadowBlur = 0;

    // Border
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(wx + 0.5, 0, whiteWidth - 1, h - 1);

    wx += whiteWidth;
  }

  // Draw black keys on top
  wx = 0;
  for (let n = startNote; n < endNote; n++) {
    if (isBlack[n % 12]) continue;

    // Check if next note is black
    if (n + 1 < endNote && isBlack[(n + 1) % 12]) {
      const isActive = activeNotes.has(n + 1);

      if (isActive) {
        ctx.fillStyle = '#ff006e';
        ctx.shadowColor = '#ff006e';
        ctx.shadowBlur = 8;
      } else {
        ctx.fillStyle = 'rgba(30,30,40,0.95)';
        ctx.shadowBlur = 0;
      }

      ctx.fillRect(wx + whiteWidth - blackWidth / 2, 0, blackWidth, blackHeight);
      ctx.shadowBlur = 0;
    }
    wx += whiteWidth;
  }
}

function clearMidiKeyboard() {
  if (midiVizCanvas && midiVizCtx) {
    midiVizCtx.clearRect(0, 0, midiVizCanvas.width, midiVizCanvas.height);
  }
  midiVizCanvas = null;
  midiVizCtx = null;
}

// ── Guitar Fretboard Visualizer ───────────────────────────────────────────────

let guitarVizCanvas = null;
let guitarVizCtx = null;

function drawGuitarFretboard() {
  if (!guitarVizCanvas) {
    guitarVizCanvas = document.getElementById('guitar-fretboard-viz');
    if (!guitarVizCanvas) return;
    guitarVizCtx = guitarVizCanvas.getContext('2d');
  }

  const dpr = window.devicePixelRatio || 1;
  const cssW = guitarVizCanvas.offsetWidth;
  const cssH = guitarVizCanvas.offsetHeight;
  if (guitarVizCanvas.width !== Math.round(cssW * dpr) || guitarVizCanvas.height !== Math.round(cssH * dpr)) {
    guitarVizCanvas.width = Math.round(cssW * dpr);
    guitarVizCanvas.height = Math.round(cssH * dpr);
    guitarVizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const w = cssW;
  const h = cssH;
  const ctx = guitarVizCtx;
  const stringStates = getStringStates();
  const tuning = getCurrentTuningInfo();
  const chordName = getCurrentChord();
  const chordShape = getChordShape(chordName);
  const now = performance.now();

  ctx.clearRect(0, 0, w, h);

  // Layout
  const leftPad = 40;
  const rightPad = 16;
  const topPad = 12;
  const bottomPad = 12;
  const playAreaW = w - leftPad - rightPad;
  const playAreaH = h - topPad - bottomPad;
  const stringSpacing = playAreaH / (6 - 1);

  // Draw fret lines (5 visible frets)
  const numFrets = 5;
  const fretSpacing = playAreaW / numFrets;
  ctx.strokeStyle = 'rgba(180, 140, 80, 0.2)';
  ctx.lineWidth = 1;
  for (let f = 0; f <= numFrets; f++) {
    const x = leftPad + f * fretSpacing;
    ctx.beginPath();
    ctx.moveTo(x, topPad - 4);
    ctx.lineTo(x, topPad + playAreaH + 4);
    ctx.stroke();
  }

  // Nut (thick line at left)
  ctx.strokeStyle = 'rgba(220, 200, 160, 0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(leftPad, topPad - 4);
  ctx.lineTo(leftPad, topPad + playAreaH + 4);
  ctx.stroke();

  // Fret dots (frets 3, 5)
  const dotFrets = [3, 5];
  ctx.fillStyle = 'rgba(180, 140, 80, 0.15)';
  for (const df of dotFrets) {
    if (df <= numFrets) {
      const dx = leftPad + (df - 0.5) * fretSpacing;
      ctx.beginPath();
      ctx.arc(dx, topPad + playAreaH / 2, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw 6 strings
  for (let i = 0; i < 6; i++) {
    const y = topPad + i * stringSpacing;
    const ss = stringStates[i];
    const thickness = 2.5 - (i * 0.3); // thicker for low strings

    // String label (note name)
    ctx.fillStyle = 'rgba(200, 180, 140, 0.7)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(tuning.notes[i], leftPad - 8, y);

    // Check if string is muted in current chord
    const isMuted = chordShape && chordShape[i] === -1;

    if (isMuted) {
      // Draw X for muted string
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(leftPad - 20, y - 5);
      ctx.lineTo(leftPad - 14, y + 5);
      ctx.moveTo(leftPad - 14, y - 5);
      ctx.lineTo(leftPad - 20, y + 5);
      ctx.stroke();
    }

    // Vibrating string animation
    if (ss && !isMuted) {
      const elapsed = now - ss.startTime;
      const progress = Math.min(elapsed / ss.decay, 1);
      const amplitude = (1 - progress) * 4 * ss.velocity;
      const vibFreq = 8 + i * 2;

      // Glowing vibrating string
      ctx.strokeStyle = `rgba(232, 168, 76, ${0.9 - progress * 0.7})`;
      ctx.shadowColor = '#e8a84c';
      ctx.shadowBlur = 6 * (1 - progress);
      ctx.lineWidth = thickness + 1;

      ctx.beginPath();
      ctx.moveTo(leftPad, y);
      for (let x = leftPad; x <= leftPad + playAreaW; x += 2) {
        const frac = (x - leftPad) / playAreaW;
        const wave = Math.sin(frac * Math.PI) * Math.sin(frac * vibFreq * Math.PI + elapsed * 0.02) * amplitude;
        ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      // Static string
      ctx.strokeStyle = isMuted ? 'rgba(120, 100, 70, 0.2)' : 'rgba(200, 170, 100, 0.4)';
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.moveTo(leftPad, y);
      ctx.lineTo(leftPad + playAreaW, y);
      ctx.stroke();
    }

    // Draw fret marker for chord
    if (chordShape && chordShape[i] > 0 && chordShape[i] <= numFrets) {
      const fret = chordShape[i];
      const fx = leftPad + (fret - 0.5) * fretSpacing;
      ctx.fillStyle = ss ? 'rgba(232, 168, 76, 0.9)' : 'rgba(232, 168, 76, 0.5)';
      ctx.beginPath();
      ctx.arc(fx, y, 5, 0, Math.PI * 2);
      ctx.fill();
      // Fret number
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 8px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fret.toString(), fx, y);
    }
  }

  // Chord name display
  if (chordName && chordName !== 'None') {
    ctx.fillStyle = 'rgba(232, 168, 76, 0.8)';
    ctx.font = 'bold 14px "Inter", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(chordName, w - rightPad, 6);
  }
}

function clearGuitarFretboard() {
  if (guitarVizCanvas && guitarVizCtx) {
    guitarVizCtx.clearRect(0, 0, guitarVizCanvas.width, guitarVizCanvas.height);
  }
  guitarVizCanvas = null;
  guitarVizCtx = null;
}

// ── Initialize ────────────────────────────────────────────────────────────────

const p5Instance = new p5(sketch, document.getElementById('canvas-container'));

// State change handler
function onStateChange(what) {
  if (what === 'aspect') {
    // Trigger a full canvas resize for aspect ratio changes
    p5Instance.windowResized();
  }
  state.needsRedraw = true;
}

// Initialize UI
let uiRef = null;

// Small delay to ensure p5 canvas is ready
setTimeout(() => {
  uiRef = initUI(state, onStateChange, animator);

  // Store sync functions for use in animation loop
  Object.assign(syncMap, uiRef);

  // Wire export buttons
  document.getElementById('btn-save').onclick = () => {
    const canvas = document.querySelector('#canvas-container canvas');
    if (canvas) savePNG(canvas);
  };

  document.getElementById('btn-record').onclick = () => {
    const canvas = document.querySelector('#canvas-container canvas');
    if (canvas) {
      if (!animator.playing) {
        document.getElementById('auto-animate').checked = true;
        const base = getAnimatorBase(state.attractorType);
        animator.setBase(base);
        animator.play();
        document.getElementById('btn-play').style.display = 'none';
        document.getElementById('btn-pause').style.display = '';
      }
      startRecording(canvas, () => {
        document.getElementById('btn-record').style.display = '';
        document.getElementById('btn-stop-record').style.display = 'none';
      }, getAudioStream());
      document.getElementById('btn-record').style.display = 'none';
      document.getElementById('btn-stop-record').style.display = '';
      document.getElementById('btn-stop-record').classList.add('recording-pulse');
    }
  };

  document.getElementById('btn-stop-record').onclick = () => {
    stopRecording();
  };

  // ── Audio Controls ──────────────────────────────────────────────────────
  const btnListen = document.getElementById('btn-listen');
  const btnStopListen = document.getElementById('btn-stop-listen');
  const statusDot = document.getElementById('audio-status-dot');
  const statusText = document.getElementById('audio-status-text');

  btnListen.onclick = async () => {
    statusDot.className = 'audio-status-dot';
    statusText.textContent = 'Connecting...';
    btnListen.disabled = true;

    const result = await startAudio();

    if (result.ok) {
      statusDot.className = 'audio-status-dot active';
      statusText.textContent = 'Listening';
      btnListen.style.display = 'none';
      btnStopListen.style.display = '';
      btnStopListen.classList.add('btn-listen-active');

      // Set animator base if not already playing
      if (!animator.playing) {
        const base = getAnimatorBase(state.attractorType);
        animator.setBase(base);
      }
    } else {
      statusDot.className = 'audio-status-dot error';
      statusText.textContent = result.error || 'Error';
    }
    btnListen.disabled = false;
  };

  btnStopListen.onclick = () => {
    stopAudio();
    resetAnalysis();
    animator.setAudioModulation(null);
    statusDot.className = 'audio-status-dot';
    statusText.textContent = 'Off';
    btnStopListen.style.display = 'none';
    btnStopListen.classList.remove('btn-listen-active');
    btnListen.style.display = '';

    // Clear visualizer
    vizCanvas = null;
    vizCtx = null;
    const vizEl = document.getElementById('audio-visualizer');
    if (vizEl) {
      const ctx = vizEl.getContext('2d');
      ctx.clearRect(0, 0, vizEl.width, vizEl.height);
    }
  };

  document.getElementById('audio-sensitivity').oninput = function () {
    state.audioSensitivity = parseFloat(this.value);
    animator.sensitivity = state.audioSensitivity;
    const valEl = document.getElementById('val-sensitivity');
    if (valEl) valEl.textContent = state.audioSensitivity.toFixed(2);
  };

  // Waveform overlay controls
  document.getElementById('waveform-toggle').onchange = function () {
    state.waveformOverlay.enabled = this.checked;
    document.getElementById('waveform-intensity-group').style.display = this.checked ? '' : 'none';
    document.getElementById('waveform-style-group').style.display = this.checked ? '' : 'none';
  };
  document.getElementById('waveform-intensity').oninput = function () {
    state.waveformOverlay.intensity = parseFloat(this.value);
    const valEl = document.getElementById('val-waveform-intensity');
    if (valEl) valEl.textContent = state.waveformOverlay.intensity.toFixed(2);
  };
  document.getElementById('waveform-style').onchange = function () {
    state.waveformOverlay.style = this.value;
  };

  // ── MIDI Controls ──────────────────────────────────────────────────────
  const midiToggle = document.getElementById('midi-toggle');
  const midiControls = document.getElementById('midi-controls');
  const midiStatusDot = document.getElementById('midi-status-dot');
  const midiStatusText = document.getElementById('midi-status-text');
  const midiDeviceName = document.getElementById('midi-device-name');

  midiToggle.onchange = async function () {
    if (this.checked) {
      midiStatusDot.className = 'midi-status-dot connecting';
      midiStatusText.textContent = 'Connecting...';

      const result = await startMidi();

      if (result.ok) {
        midiStatusDot.className = 'midi-status-dot active';
        const devices = result.devices || getMidiDevices();
        if (devices.length > 0) {
          midiStatusText.textContent = 'Connected';
          midiDeviceName.textContent = devices[0];
        } else {
          midiStatusText.textContent = 'Ready';
          midiDeviceName.textContent = 'Use keyboard or click';
        }
        midiControls.style.display = '';
        // Show the full-width keyboard and effects drawer below the canvas
        document.getElementById('midi-keyboard-viz').style.display = 'block';
        document.getElementById('midi-effects-drawer').style.display = '';
        document.getElementById('drum-effects-drawer').style.display = '';
        document.getElementById('bass-effects-drawer').style.display = '';
        document.getElementById('vfx-drawer').style.display = '';
        document.getElementById('voice-mode-bar').style.display = '';

        // Init bass synth with MIDI's audio context
        const bassCtx = getMidiAudioContext();
        const bassOut = getMidiMasterGain();
        if (bassCtx && bassOut) initBass(bassCtx, bassOut);

        // If mic is active, stop it (MIDI takes priority)
        if (isAudioActive()) {
          stopAudio();
          resetAnalysis();
          statusDot.className = 'audio-status-dot';
          statusText.textContent = 'Off';
          btnStopListen.style.display = 'none';
          btnListen.style.display = '';
        }

        // Set animator base
        if (!animator.playing) {
          const base = getAnimatorBase(state.attractorType);
          animator.setBase(base);
        }

        setNoteCallback(() => { state.needsRedraw = true; });
      } else {
        midiStatusDot.className = 'midi-status-dot error';
        midiStatusText.textContent = result.error || 'Error';
        this.checked = false;
      }
    } else {
      stopMidi();
      resetAnalysis();
      animator.setAudioModulation(null);
      midiStatusDot.className = 'midi-status-dot';
      midiStatusText.textContent = 'Off';
      midiDeviceName.textContent = '—';
      midiControls.style.display = 'none';
      document.getElementById('midi-keyboard-viz').style.display = 'none';
      document.getElementById('midi-effects-drawer').style.display = 'none';
      document.getElementById('drum-effects-drawer').style.display = 'none';
      document.getElementById('bass-effects-drawer').style.display = 'none';
      document.getElementById('vfx-drawer').style.display = 'none';
      document.getElementById('voice-mode-bar').style.display = 'none';
      destroyBass();
      // Reset drawer state
      const drawerContent = document.getElementById('midi-drawer-content');
      const drawerToggle = document.getElementById('midi-drawer-toggle');
      drawerContent.classList.remove('open');
      drawerToggle.classList.remove('open');
      // Stop drum machine
      stopDrumSequencer();
      clearDrumPattern();
      buildDrumGrid();
      document.querySelectorAll('.drum-step').forEach(c => { c.classList.remove('active'); c.classList.remove('current'); });
      clearMidiKeyboard();
    }
  };

  // Auto-start MIDI with effects drawer open
  setTimeout(() => {
    midiToggle.checked = true;
    midiToggle.onchange.call(midiToggle).then(() => {
      // Open the effects drawer
      const dc = document.getElementById('midi-drawer-content');
      const dt = document.getElementById('midi-drawer-toggle');
      dc.classList.add('open');
      dt.classList.add('open');
    });
  }, 500);

  document.getElementById('midi-waveform').onchange = function () {
    setMidiWaveform(this.value);
  };

  // ── MIDI Effects Drawer ────────────────────────────────────────────────
  const drawerToggleBtn = document.getElementById('midi-drawer-toggle');
  const drawerContent = document.getElementById('midi-drawer-content');

  drawerToggleBtn.onclick = () => {
    const isOpen = drawerContent.classList.toggle('open');
    drawerToggleBtn.classList.toggle('open', isOpen);
  };

  // Synth presets
  const synthPresetSel = document.getElementById('fx-synth-preset');
  getSynthPresetNames().forEach(({ key, label }) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    synthPresetSel.appendChild(opt);
  });

  function syncSynthUI() {
    const p = getEffectParams();
    // Waveform
    const waveEl = document.getElementById('fx-waveform');
    const sidebarWave = document.getElementById('midi-waveform');
    // Filter
    const cutoffEl = document.getElementById('fx-cutoff');
    const cutoffVal = document.getElementById('fx-val-cutoff');
    const resoEl = document.getElementById('fx-reso');
    const resoVal = document.getElementById('fx-val-reso');
    const filterTypeEl = document.getElementById('fx-filter-type');
    // Distortion
    const driveEl = document.getElementById('fx-distortion');
    const driveVal = document.getElementById('fx-val-drive');
    // ADSR
    const atkEl = document.getElementById('fx-attack');
    const atkVal = document.getElementById('fx-val-attack');
    const decEl = document.getElementById('fx-decay');
    const decVal = document.getElementById('fx-val-decay');
    const susEl = document.getElementById('fx-sustain');
    const susVal = document.getElementById('fx-val-sustain');
    const relEl = document.getElementById('fx-release');
    const relVal = document.getElementById('fx-val-release');
    // Delay
    const dTimeEl = document.getElementById('fx-delay-time');
    const dTimeVal = document.getElementById('fx-val-delay-time');
    const dFeedEl = document.getElementById('fx-delay-feedback');
    const dFeedVal = document.getElementById('fx-val-delay-feedback');
    const dMixEl = document.getElementById('fx-delay-mix');
    const dMixVal = document.getElementById('fx-val-delay-mix');
    // Reverb
    const rMixEl = document.getElementById('fx-reverb-mix');
    const rMixVal = document.getElementById('fx-val-reverb-mix');
    const rDecEl = document.getElementById('fx-reverb-decay');
    const rDecVal = document.getElementById('fx-val-reverb-decay');
    // Octave
    const octEl = document.getElementById('fx-octave');
    const octVal = document.getElementById('fx-val-octave');
    // Wah
    if (waveEl) waveEl.value = p.waveform || 'sawtooth';
    if (sidebarWave) sidebarWave.value = p.waveform || 'sawtooth';
    if (cutoffEl) { cutoffEl.value = p.filter.cutoff; if (cutoffVal) cutoffVal.textContent = Math.round(p.filter.cutoff); }
    if (resoEl) { resoEl.value = p.filter.q; if (resoVal) resoVal.textContent = p.filter.q.toFixed(1); }
    if (filterTypeEl) filterTypeEl.value = p.filter.type;
    if (driveEl) { driveEl.value = p.distortion.drive; if (driveVal) driveVal.textContent = p.distortion.drive.toFixed(1); }
    if (atkEl) { atkEl.value = p.adsr.attack; if (atkVal) atkVal.textContent = p.adsr.attack.toFixed(2); }
    if (decEl) { decEl.value = p.adsr.decay; if (decVal) decVal.textContent = p.adsr.decay.toFixed(2); }
    if (susEl) { susEl.value = p.adsr.sustain; if (susVal) susVal.textContent = p.adsr.sustain.toFixed(2); }
    if (relEl) { relEl.value = p.adsr.release; if (relVal) relVal.textContent = p.adsr.release.toFixed(2); }
    if (dTimeEl) { dTimeEl.value = p.delay.time; if (dTimeVal) dTimeVal.textContent = p.delay.time.toFixed(2); }
    if (dFeedEl) { dFeedEl.value = p.delay.feedback; if (dFeedVal) dFeedVal.textContent = p.delay.feedback.toFixed(2); }
    if (dMixEl) { dMixEl.value = p.delay.mix; if (dMixVal) dMixVal.textContent = p.delay.mix.toFixed(2); }
    if (rMixEl) { rMixEl.value = p.reverb.mix; if (rMixVal) rMixVal.textContent = p.reverb.mix.toFixed(2); }
    if (rDecEl) { rDecEl.value = p.reverb.decay; if (rDecVal) rDecVal.textContent = p.reverb.decay.toFixed(2); }
    if (octEl) { octEl.value = p.octaveShift; if (octVal) octVal.textContent = p.octaveShift; }
    // Wah
    const wahEn = document.getElementById('fx-wah-toggle');
    const wahRateEl = document.getElementById('fx-wah-rate');
    const wahRateVal = document.getElementById('fx-val-wah-rate');
    const wahDepthEl = document.getElementById('fx-wah-depth');
    const wahDepthVal = document.getElementById('fx-val-wah-depth');
    const wahBaseEl = document.getElementById('fx-wah-base');
    const wahBaseVal = document.getElementById('fx-val-wah-base');
    if (wahEn) wahEn.checked = p.wah.enabled;
    if (wahRateEl) { wahRateEl.value = p.wah.rate; if (wahRateVal) wahRateVal.textContent = p.wah.rate.toFixed(1); }
    if (wahDepthEl) { wahDepthEl.value = p.wah.depth; if (wahDepthVal) wahDepthVal.textContent = Math.round(p.wah.depth); }
    if (wahBaseEl) { wahBaseEl.value = p.wah.baseFreq; if (wahBaseVal) wahBaseVal.textContent = Math.round(p.wah.baseFreq); }
  }

  synthPresetSel.onchange = function () {
    if (!this.value) return;
    loadSynthPreset(this.value);
    syncSynthUI();
  };

  // Synth controls
  document.getElementById('fx-waveform').onchange = function () {
    setMidiWaveform(this.value);
    synthPresetSel.value = '';
    const sidebar = document.getElementById('midi-waveform');
    if (sidebar) sidebar.value = this.value;
  };

  document.getElementById('fx-octave').oninput = function () {
    setOctaveShift(parseInt(this.value));
    document.getElementById('fx-val-octave').textContent = this.value;
  };

  document.getElementById('fx-volume').oninput = function () {
    setMasterVolume(parseFloat(this.value));
    document.getElementById('fx-val-volume').textContent = parseFloat(this.value).toFixed(2);
  };

  // ADSR
  document.getElementById('fx-attack').oninput = function () {
    document.getElementById('fx-val-attack').textContent = parseFloat(this.value).toFixed(2);
    syncADSR();
  };
  document.getElementById('fx-decay').oninput = function () {
    document.getElementById('fx-val-decay').textContent = parseFloat(this.value).toFixed(2);
    syncADSR();
  };
  document.getElementById('fx-sustain').oninput = function () {
    document.getElementById('fx-val-sustain').textContent = parseFloat(this.value).toFixed(2);
    syncADSR();
  };
  document.getElementById('fx-release').oninput = function () {
    document.getElementById('fx-val-release').textContent = parseFloat(this.value).toFixed(2);
    syncADSR();
  };
  function syncADSR() {
    setADSR(
      parseFloat(document.getElementById('fx-attack').value),
      parseFloat(document.getElementById('fx-decay').value),
      parseFloat(document.getElementById('fx-sustain').value),
      parseFloat(document.getElementById('fx-release').value)
    );
  }

  // Scale Lock
  document.getElementById('fx-scale-toggle').onchange = function () {
    setScaleLock(this.checked);
  };
  document.getElementById('fx-scale-root').onchange = function () {
    setScaleRoot(parseInt(this.value));
  };
  document.getElementById('fx-scale-type').onchange = function () {
    setScaleType(this.value);
  };

  // Chord Mode
  document.getElementById('fx-chord-toggle').onchange = function () {
    setChordEnabled(this.checked);
  };
  document.getElementById('fx-chord-type').onchange = function () {
    setChordType(this.value);
  };

  // Arpeggiator
  document.getElementById('fx-arp-toggle').onchange = function () {
    setArpEnabled(this.checked);
  };
  document.getElementById('fx-arp-pattern').onchange = function () {
    setArpPattern(this.value);
  };
  document.getElementById('fx-arp-rate').onchange = function () {
    setArpRate(this.value);
  };
  document.getElementById('fx-arp-bpm').oninput = function () {
    const v = parseInt(this.value);
    setGlobalBPM(v);
    document.getElementById('fx-val-arp-bpm').textContent = v;
  };
  document.getElementById('fx-arp-octaves').oninput = function () {
    const v = parseInt(this.value);
    setArpOctaves(v);
    document.getElementById('fx-val-arp-oct').textContent = v;
  };

  // Filter
  document.getElementById('fx-filter-type').onchange = function () {
    setFilterType(this.value);
  };
  document.getElementById('fx-filter-cutoff').oninput = function () {
    const v = parseInt(this.value);
    setFilterCutoff(v);
    document.getElementById('fx-val-cutoff').textContent = v;
  };
  document.getElementById('fx-filter-q').oninput = function () {
    const v = parseFloat(this.value);
    setFilterQ(v);
    document.getElementById('fx-val-q').textContent = v.toFixed(1);
  };

  // Distortion
  document.getElementById('fx-distortion').oninput = function () {
    const v = parseFloat(this.value);
    setDistortionDrive(v);
    document.getElementById('fx-val-drive').textContent = v.toFixed(1);
  };

  // Wah-Wah
  document.getElementById('fx-wah-toggle').onchange = function () {
    setWahEnabled(this.checked);
  };
  document.getElementById('fx-wah-rate').oninput = function () {
    const v = parseFloat(this.value);
    setWahRate(v);
    document.getElementById('fx-val-wah-rate').textContent = v.toFixed(1);
  };
  document.getElementById('fx-wah-depth').oninput = function () {
    const v = parseInt(this.value);
    setWahDepth(v);
    document.getElementById('fx-val-wah-depth').textContent = v;
  };
  document.getElementById('fx-wah-base').oninput = function () {
    const v = parseInt(this.value);
    setWahBaseFreq(v);
    document.getElementById('fx-val-wah-base').textContent = v;
  };

  // Delay
  document.getElementById('fx-delay-time').oninput = function () {
    const v = parseFloat(this.value);
    setDelayTime(v);
    document.getElementById('fx-val-delay-time').textContent = v.toFixed(2);
  };
  document.getElementById('fx-delay-feedback').oninput = function () {
    const v = parseFloat(this.value);
    setDelayFeedback(v);
    document.getElementById('fx-val-delay-fb').textContent = v.toFixed(2);
  };
  document.getElementById('fx-delay-mix').oninput = function () {
    const v = parseFloat(this.value);
    setDelayMix(v);
    document.getElementById('fx-val-delay-mix').textContent = v.toFixed(2);
  };

  // Reverb
  document.getElementById('fx-reverb-mix').oninput = function () {
    const v = parseFloat(this.value);
    setReverbMix(v);
    document.getElementById('fx-val-reverb-mix').textContent = v.toFixed(2);
  };
  document.getElementById('fx-reverb-decay').oninput = function () {
    const v = parseFloat(this.value);
    setReverbDecay(v);
    document.getElementById('fx-val-reverb-decay').textContent = v.toFixed(2);
  };

  // Looper
  const looperRec = document.getElementById('fx-looper-rec');
  const looperPlay = document.getElementById('fx-looper-play');
  const looperStop = document.getElementById('fx-looper-stop');
  const looperStatus = document.getElementById('fx-looper-status');

  setLooperCallback((loopState) => {
    looperStatus.textContent = loopState;
    looperRec.classList.toggle('recording', loopState === 'recording');
    looperPlay.classList.toggle('playing', loopState === 'playing');
    looperPlay.disabled = (loopState === 'idle' || loopState === 'recording');
    looperStop.disabled = (loopState === 'idle');
    looperPlay.textContent = loopState === 'playing' ? '⏸' : '▶';
  });

  looperRec.onclick = () => {
    const ls = getLooperState();
    if (ls === 'recording') {
      stopLooperRecording();
    } else {
      if (ls === 'playing') stopLooper();
      startLooperRecording();
    }
  };

  looperPlay.onclick = () => {
    toggleLooperPlayback();
  };

  looperStop.onclick = () => {
    stopLooper();
  };

  // ── Drum Machine ────────────────────────────────────────────────────────
  const drumPlayBtn = document.getElementById('drum-play');
  const drumStopBtn = document.getElementById('drum-stop');
  const drumClearBtn = document.getElementById('drum-clear');
  const drumBpmSlider = document.getElementById('drum-bpm');
  const drumBpmVal = document.getElementById('drum-bpm-val');
  const drumVolSlider = document.getElementById('drum-volume');
  const drumVolVal = document.getElementById('drum-vol-val');
  const drumSwingSlider = document.getElementById('drum-swing');
  const drumSwingVal = document.getElementById('drum-swing-val');
  const drumPresetSel = document.getElementById('drum-preset');
  const drumGrid = document.getElementById('drum-grid');

  const TRACK_LABELS = { kick: 'Kick', snare: 'Snare', hihat: 'HiHat', clap: 'Clap', tom: 'Tom', rim: 'Rim', cowbell: 'Cowbl', openhh: 'OpnHH' };

  function buildDrumGrid() {
    drumGrid.innerHTML = '';
    const tracks = getDrumTrackNames();
    const steps = getDrumStepCount();
    const pattern = getDrumPattern();

    tracks.forEach((trackName, t) => {
      const row = document.createElement('div');
      row.className = 'drum-row';
      row.dataset.track = t;

      // Label
      const label = document.createElement('span');
      label.className = 'drum-label';
      label.textContent = TRACK_LABELS[trackName] || trackName;
      row.appendChild(label);

      // Mute/Solo
      const ms = document.createElement('div');
      ms.className = 'drum-ms';
      const muteBtn = document.createElement('button');
      muteBtn.className = 'drum-mute-btn';
      muteBtn.textContent = 'M';
      muteBtn.onclick = () => { muteBtn.classList.toggle('active'); setDrumMute(t, muteBtn.classList.contains('active')); };
      const soloBtn = document.createElement('button');
      soloBtn.className = 'drum-solo-btn';
      soloBtn.textContent = 'S';
      soloBtn.onclick = () => { soloBtn.classList.toggle('active'); setDrumSolo(t, soloBtn.classList.contains('active')); };
      ms.appendChild(muteBtn);
      ms.appendChild(soloBtn);
      row.appendChild(ms);

      // Steps
      const stepsDiv = document.createElement('div');
      stepsDiv.className = 'drum-steps';
      for (let s = 0; s < steps; s++) {
        const cell = document.createElement('div');
        cell.className = 'drum-step';
        if (pattern[t] && pattern[t][s]) cell.classList.add('active');
        cell.dataset.step = s;
        cell.onclick = () => {
          const isActive = toggleDrumStep(t, s);
          cell.classList.toggle('active', isActive);
          drumPresetSel.value = ''; // custom
        };
        stepsDiv.appendChild(cell);
      }
      row.appendChild(stepsDiv);
      drumGrid.appendChild(row);
    });
  }

  buildDrumGrid();

  // Global tempo sync: when any BPM source changes, sync all displays + guitar riffs
  setTempoChangeCallback((bpm) => {
    // Sync drum tempo slider + display
    drumBpmSlider.value = bpm;
    drumBpmVal.textContent = bpm;
    // Sync arp BPM slider + display
    const arpBpmSlider = document.getElementById('fx-arp-bpm');
    const arpBpmDisplay = document.getElementById('fx-val-arp-bpm');
    if (arpBpmSlider) arpBpmSlider.value = bpm;
    if (arpBpmDisplay) arpBpmDisplay.textContent = bpm;
    // Sync guitar riff tempo
    setRiffBPM(bpm);
  });

  drumBpmSlider.oninput = function () {
    const v = parseInt(this.value);
    setGlobalBPM(v);
    drumBpmVal.textContent = v;
  };

  drumVolSlider.oninput = function () {
    const v = parseFloat(this.value);
    setDrumVolume(v);
    drumVolVal.textContent = v.toFixed(2);
  };

  drumSwingSlider.oninput = function () {
    const v = parseFloat(this.value);
    setDrumSwing(v);
    drumSwingVal.textContent = Math.round(v * 100) + '%';
  };

  drumPresetSel.onchange = function () {
    if (this.value) {
      loadDrumPreset(this.value);
      buildDrumGrid();
    }
  };

  // 16/32 step toggle
  const step16Btn = document.getElementById('drum-steps-16');
  const step32Btn = document.getElementById('drum-steps-32');
  step16Btn.onclick = () => {
    step16Btn.classList.add('active'); step32Btn.classList.remove('active');
    setDrumStepCount(16); buildDrumGrid();
  };
  step32Btn.onclick = () => {
    step32Btn.classList.add('active'); step16Btn.classList.remove('active');
    setDrumStepCount(32); buildDrumGrid();
  };

  drumPlayBtn.onclick = () => {
    if (isDrumPlaying()) {
      stopDrumSequencer();
      drumPlayBtn.textContent = '▶';
      drumStopBtn.disabled = true;
    } else {
      startDrumSequencer();
      drumPlayBtn.textContent = '⏸';
      drumStopBtn.disabled = false;
    }
  };

  drumStopBtn.onclick = () => {
    stopDrumSequencer();
    drumPlayBtn.textContent = '▶';
    drumStopBtn.disabled = true;
  };

  drumClearBtn.onclick = () => {
    clearDrumPattern();
    buildDrumGrid();
  };

  // Step highlight callback
  setDrumStepCallback((step) => {
    document.querySelectorAll('.drum-step.current').forEach(c => c.classList.remove('current'));
    if (step >= 0) {
      document.querySelectorAll('#drum-grid .drum-row').forEach((row) => {
        const cells = row.querySelectorAll('.drum-step');
        if (cells[step]) cells[step].classList.add('current');
      });
    }
  });

  // Drum drawer toggle
  const drumDrawerToggle = document.getElementById('drum-drawer-toggle');
  const drumDrawerContent = document.getElementById('drum-drawer-content');
  drumDrawerToggle.onclick = () => {
    drumDrawerContent.classList.toggle('open');
    drumDrawerToggle.classList.toggle('open');
  };

  // ── Bass Synth Drawer ────────────────────────────────────────────────────
  const bassDrawerToggle = document.getElementById('bass-drawer-toggle');
  const bassDrawerContent = document.getElementById('bass-drawer-content');
  bassDrawerToggle.onclick = () => {
    bassDrawerContent.classList.toggle('open');
    bassDrawerToggle.classList.toggle('open');
  };

  // ── Visual FX Drawer ────────────────────────────────────────────────────
  const vfxDrawerToggle = document.getElementById('vfx-drawer-toggle');
  const vfxDrawerContent = document.getElementById('vfx-drawer-content');
  vfxDrawerToggle.onclick = () => {
    vfxDrawerContent.classList.toggle('open');
    vfxDrawerToggle.classList.toggle('open');
  };

  // Bass controls
  document.getElementById('bass-wave').onchange = function () { setBassWaveform(this.value); };
  document.getElementById('bass-sub-wave').onchange = function () { setBassSubWave(this.value); };
  document.getElementById('bass-sub-level').oninput = function () {
    setBassSubLevel(parseFloat(this.value));
    document.getElementById('bass-sub-level-val').textContent = parseFloat(this.value).toFixed(2);
  };
  document.getElementById('bass-cutoff').oninput = function () {
    setBassCutoff(parseFloat(this.value));
    document.getElementById('bass-cutoff-val').textContent = Math.round(this.value);
  };
  document.getElementById('bass-reso').oninput = function () {
    setBassResonance(parseFloat(this.value));
    document.getElementById('bass-reso-val').textContent = parseFloat(this.value).toFixed(1);
  };
  document.getElementById('bass-env-amt').oninput = function () {
    setBassEnvAmount(parseFloat(this.value));
    document.getElementById('bass-env-amt-val').textContent = Math.round(this.value);
  };
  document.getElementById('bass-env-decay').oninput = function () {
    setBassEnvDecay(parseFloat(this.value));
    document.getElementById('bass-env-decay-val').textContent = parseFloat(this.value).toFixed(2);
  };
  document.getElementById('bass-glide').oninput = function () {
    setBassGlide(parseFloat(this.value));
    document.getElementById('bass-glide-val').textContent = parseFloat(this.value).toFixed(2);
  };
  document.getElementById('bass-octave').oninput = function () {
    setBassOctave(parseInt(this.value));
    document.getElementById('bass-octave-val').textContent = this.value;
  };
  document.getElementById('bass-volume').oninput = function () {
    setBassVolume(parseFloat(this.value));
    document.getElementById('bass-volume-val').textContent = parseFloat(this.value).toFixed(2);
  };
  document.getElementById('bass-accent').onchange = function () { setBassAccent(this.checked); };

  // ── Guitar Controls ─────────────────────────────────────────────────────
  const guitarToggle = document.getElementById('guitar-toggle');
  const guitarStatusDot = document.getElementById('guitar-status-dot');
  const guitarStatusText = document.getElementById('guitar-status-text');
  const guitarFretboardViz = document.getElementById('guitar-fretboard-viz');

  guitarToggle.onchange = async function () {
    if (this.checked) {
      guitarStatusDot.className = 'midi-status-dot connecting';
      guitarStatusText.textContent = 'Starting...';

      const result = await startGuitar();

      if (result.ok) {
        guitarStatusDot.className = 'midi-status-dot active';
        guitarStatusText.textContent = 'Active';
        guitarFretboardViz.style.display = 'block';
        // Show guitar's own pedalboard drawer
        document.getElementById('guitar-effects-drawer').style.display = '';

        // Set animator base for audio reactivity
        if (!animator.playing) {
          const base = getAnimatorBase(state.attractorType);
          animator.setBase(base);
        }

        setPluckCallback(() => { state.needsRedraw = true; });
      } else {
        guitarStatusDot.className = 'midi-status-dot error';
        guitarStatusText.textContent = result.error || 'Error';
        this.checked = false;
      }
    } else {
      stopGuitar();
      guitarStatusDot.className = 'midi-status-dot';
      guitarStatusText.textContent = 'Off';
      guitarFretboardViz.style.display = 'none';
      document.getElementById('guitar-effects-drawer').style.display = 'none';
      clearGuitarFretboard();
    }
  };

  // Guitar fretboard click-to-pluck interaction
  guitarFretboardViz.addEventListener('mousedown', (e) => {
    if (!isGuitarActive()) return;
    const rect = guitarFretboardViz.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const topPad = 12;
    const bottomPad = 12;
    const playAreaH = h - topPad - bottomPad;
    const stringSpacing = playAreaH / 5;

    // Find nearest string
    const relY = y - topPad;
    const stringIndex = Math.round(relY / stringSpacing);
    const clamped = Math.max(0, Math.min(5, stringIndex));

    // Velocity based on how far right they click (left = soft, right = hard)
    const x = e.clientX - rect.left;
    const velocity = 0.4 + (x / rect.width) * 0.5;

    pluckString(clamped, velocity);
    state.needsRedraw = true;
  });

  // Drag-to-strum: detect mousemove across strings while dragging
  let guitarDragging = false;
  let lastDragString = -1;
  guitarFretboardViz.addEventListener('mousedown', () => {
    guitarDragging = true;
    lastDragString = -1;
  });
  window.addEventListener('mouseup', () => {
    guitarDragging = false;
    lastDragString = -1;
  });
  guitarFretboardViz.addEventListener('mousemove', (e) => {
    if (!guitarDragging || !isGuitarActive()) return;
    const rect = guitarFretboardViz.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const topPad = 12;
    const playAreaH = h - topPad - 12;
    const stringSpacing = playAreaH / 5;
    const relY = y - topPad;
    const stringIndex = Math.max(0, Math.min(5, Math.round(relY / stringSpacing)));

    if (stringIndex !== lastDragString) {
      const x = e.clientX - rect.left;
      const velocity = 0.4 + (x / rect.width) * 0.5;
      pluckString(stringIndex, velocity);
      lastDragString = stringIndex;
      state.needsRedraw = true;
    }
  });

  // Strum buttons
  document.getElementById('guitar-strum-down').onclick = () => {
    if (isGuitarActive()) strumChord('down', 0.7);
  };
  document.getElementById('guitar-strum-up').onclick = () => {
    if (isGuitarActive()) strumChord('up', 0.7);
  };

  // Tuning selector
  document.getElementById('guitar-tuning').onchange = function () {
    setGuitarTuning(this.value);
  };

  // Chord selector
  document.getElementById('guitar-chord').onchange = function () {
    setGuitarChord(this.value);
  };

  // Guitar volume
  document.getElementById('guitar-volume').oninput = function () {
    const v = parseFloat(this.value);
    setGuitarVolume(v);
    document.getElementById('guitar-vol-val').textContent = v.toFixed(2);
  };

  // Riff controls
  const riffSelect = document.getElementById('guitar-riff');
  const riffPlayBtn = document.getElementById('guitar-riff-play');
  const riffStopBtn = document.getElementById('guitar-riff-stop');

  riffSelect.onchange = function () {
    setCurrentRiff(this.value);
    if (this.value === 'none') {
      stopRiff();
      riffPlayBtn.textContent = '▶ Play';
      riffStopBtn.disabled = true;
    }
  };

  riffPlayBtn.onclick = () => {
    if (!isGuitarActive()) return;
    const riffKey = riffSelect.value;
    if (riffKey === 'none') return;

    if (isRiffPlaying()) {
      stopRiff();
      riffPlayBtn.textContent = '▶ Play';
      riffStopBtn.disabled = true;
    } else {
      playRiff(riffKey);
      riffPlayBtn.textContent = '⏸ Pause';
      riffStopBtn.disabled = false;
    }
  };

  riffStopBtn.onclick = () => {
    stopRiff();
    riffPlayBtn.textContent = '▶ Play';
    riffStopBtn.disabled = true;
  };

  // ── Guitar Drawer Toggle ────────────────────────────────────────────────
  const guitarDrawerToggle = document.getElementById('guitar-drawer-toggle');
  const guitarDrawerContent = document.getElementById('guitar-drawer-content');

  guitarDrawerToggle.onclick = () => {
    guitarDrawerContent.classList.toggle('open');
    guitarDrawerToggle.classList.toggle('open');
  };

  // ── Pedal Controls ──────────────────────────────────────────────────────
  const PEDAL_NAMES = ['overdrive', 'chorus', 'phaser', 'delay', 'reverb', 'tremolo'];

  PEDAL_NAMES.forEach(name => {
    // Toggle
    const toggle = document.getElementById(`pedal-toggle-${name}`);
    const led = document.getElementById(`pedal-led-${name}`);
    if (toggle) {
      toggle.onchange = function () {
        togglePedal(name, this.checked);
        led.classList.toggle('on', this.checked);
      };
    }
  });

  // Wire all pedal parameter sliders using a data-driven approach
  const PEDAL_PARAMS = {
    'pedal-overdrive-drive': { pedal: 'overdrive', param: 'drive', fmt: v => v.toFixed(1) },
    'pedal-overdrive-tone': { pedal: 'overdrive', param: 'tone', fmt: v => Math.round(v).toString() },
    'pedal-chorus-rate': { pedal: 'chorus', param: 'rate', fmt: v => v.toFixed(1) },
    'pedal-chorus-depth': { pedal: 'chorus', param: 'depth', fmt: v => v.toFixed(3) },
    'pedal-phaser-rate': { pedal: 'phaser', param: 'rate', fmt: v => v.toFixed(1) },
    'pedal-phaser-depth': { pedal: 'phaser', param: 'depth', fmt: v => Math.round(v).toString() },
    'pedal-delay-time': { pedal: 'delay', param: 'time', fmt: v => v.toFixed(2) },
    'pedal-delay-feedback': { pedal: 'delay', param: 'feedback', fmt: v => v.toFixed(2) },
    'pedal-delay-mix': { pedal: 'delay', param: 'mix', fmt: v => v.toFixed(2) },
    'pedal-reverb-decay': { pedal: 'reverb', param: 'decay', fmt: v => v.toFixed(1) },
    'pedal-reverb-mix': { pedal: 'reverb', param: 'mix', fmt: v => v.toFixed(2) },
    'pedal-tremolo-rate': { pedal: 'tremolo', param: 'rate', fmt: v => v.toFixed(1) },
    'pedal-tremolo-depth': { pedal: 'tremolo', param: 'depth', fmt: v => v.toFixed(2) },
  };

  for (const [sliderId, cfg] of Object.entries(PEDAL_PARAMS)) {
    const slider = document.getElementById(sliderId);
    const valEl = document.getElementById(`pedal-val-${cfg.pedal}-${cfg.param}`);
    if (slider) {
      slider.oninput = function () {
        const v = parseFloat(this.value);
        setPedalParam(cfg.pedal, cfg.param, v);
        if (valEl) valEl.textContent = cfg.fmt(v);
      };
    }
  }

  // ── Visual FX Shader Layer Controls ──────────────────────────────────
  const shaderLayersEl = document.getElementById('shader-layers');
  const PRESET_LABELS = {
    kaleidoscope: 'Kaleidoscope', liquid: 'Liquid Warp', rgbShift: 'RGB Shift',
    tunnel: 'Tunnel Zoom', pixelMosaic: 'Pixel Mosaic', edgeGlow: 'Edge Glow',
    colorCycle: 'Color Cycle', glitch: 'Glitch',
    domainWarp: 'Domain Warp', heatDistort: 'Heat Distort', voidRipple: 'Void Ripple',
    starNest: 'Star Nest', plasmaGlobe: 'Plasma Globe', aurora: 'Aurora',
    ocean: 'Ocean', warpTunnel: 'Warp Tunnel'
  };

  function buildPresetOptions() {
    const builtIn = getShaderPresetNames();
    const custom = getCustomShaderNames();
    let html = '<option value="off">Off</option>';
    builtIn.forEach(k => {
      html += `<option value="${k}">${PRESET_LABELS[k] || k}</option>`;
    });
    if (custom.length) {
      html += '<optgroup label="Custom">';
      custom.forEach(k => { html += `<option value="${k}">${k}</option>`; });
      html += '</optgroup>';
    }
    return html;
  }

  function renderShaderLayers() {
    const lyrs = getLayers();
    const blendModes = getBlendModes();
    shaderLayersEl.innerHTML = '';
    lyrs.forEach((layer, i) => {
      const row = document.createElement('div');
      row.className = 'shader-layer-row';
      row.innerHTML = `
        <span class="shader-layer-num">${i + 1}</span>
        <select class="shader-layer-preset" data-idx="${i}">${buildPresetOptions()}</select>
        <select class="shader-layer-blend" data-idx="${i}">
          ${blendModes.map(m => `<option value="${m}"${m === layer.blendMode ? ' selected' : ''}>${m}</option>`).join('')}
        </select>
        <input type="range" class="shader-layer-intensity" data-idx="${i}" min="0" max="1" step="0.01" value="${layer.intensity}" />
        <span class="shader-layer-val">${layer.intensity.toFixed(2)}</span>
        <button class="shader-layer-remove" data-idx="${i}" title="Remove layer">✕</button>
      `;
      // Set selected preset
      row.querySelector('.shader-layer-preset').value = layer.preset;
      shaderLayersEl.appendChild(row);
    });

    // Bind events
    shaderLayersEl.querySelectorAll('.shader-layer-preset').forEach(sel => {
      sel.onchange = function () { setLayerPreset(+this.dataset.idx, this.value); };
    });
    shaderLayersEl.querySelectorAll('.shader-layer-blend').forEach(sel => {
      sel.onchange = function () { setLayerBlendMode(+this.dataset.idx, this.value); };
    });
    shaderLayersEl.querySelectorAll('.shader-layer-intensity').forEach(slider => {
      slider.oninput = function () {
        const idx = +this.dataset.idx;
        const v = parseFloat(this.value);
        setLayerIntensity(idx, v);
        this.nextElementSibling.textContent = v.toFixed(2);
      };
    });
    shaderLayersEl.querySelectorAll('.shader-layer-remove').forEach(btn => {
      btn.onclick = function () {
        removeLayer(+this.dataset.idx);
        renderShaderLayers();
      };
    });

    // Toggle add button visibility
    const addBtn = document.getElementById('shader-add-layer');
    if (addBtn) addBtn.style.display = lyrs.length >= getMaxLayers() ? 'none' : '';
  }

  // Add layer button
  document.getElementById('shader-add-layer').onclick = () => {
    addLayer('off', 0.5, 'normal');
    renderShaderLayers();
  };

  // Start with one layer
  addLayer('off', 0.5, 'normal');
  renderShaderLayers();

  // ── Paste GLSL Modal ────────────────────────────────────────────────────
  const glslModal = document.getElementById('glsl-paste-modal');
  const glslNameInput = document.getElementById('glsl-paste-name');
  const glslCodeInput = document.getElementById('glsl-paste-code');
  const glslError = document.getElementById('glsl-paste-error');

  document.getElementById('shader-paste-glsl').onclick = () => {
    glslNameInput.value = '';
    glslCodeInput.value = '';
    glslError.textContent = '';
    glslModal.showModal();
  };

  document.getElementById('glsl-paste-cancel').onclick = () => glslModal.close();

  document.getElementById('glsl-paste-import').onclick = () => {
    const name = glslNameInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const code = glslCodeInput.value.trim();
    if (!name) { glslError.textContent = 'Please enter a name'; return; }
    if (!code) { glslError.textContent = 'Please paste GLSL code'; return; }
    const result = importShadertoyGLSL(code, name);
    if (result.success) {
      glslModal.close();

      // Auto-apply: find first 'off' layer, or add a new one
      const lyrs = getLayers();
      let applied = false;
      for (let i = 0; i < lyrs.length; i++) {
        if (lyrs[i].preset === 'off') {
          setLayerPreset(i, name);
          setLayerIntensity(i, 0.5);
          applied = true;
          break;
        }
      }
      if (!applied && lyrs.length < getMaxLayers()) {
        addLayer(name, 0.5, 'normal');
      }

      renderShaderLayers();
      renderCustomShaderLibrary();
    } else {
      glslError.textContent = result.error;
    }
  };

  // Close modal on backdrop click
  glslModal.addEventListener('click', (e) => {
    if (e.target === glslModal) glslModal.close();
  });

  // ── Custom Shader Library (saved shaders with delete) ───────────────────
  const shaderLibraryEl = document.getElementById('custom-shader-library');
  const shaderListEl = document.getElementById('custom-shader-list');

  function renderCustomShaderLibrary() {
    const names = getCustomShaderNames();
    if (names.length === 0) {
      shaderLibraryEl.style.display = 'none';
      return;
    }
    shaderLibraryEl.style.display = '';
    shaderListEl.innerHTML = '';
    names.forEach(name => {
      const row = document.createElement('div');
      row.className = 'shader-lib-item';
      row.innerHTML = `
        <span class="shader-lib-name" title="${name}">${name}</span>
        <button class="shader-lib-delete" title="Delete ${name}">✕</button>
      `;
      row.querySelector('.shader-lib-delete').onclick = () => {
        removeCustomShader(name);
        renderShaderLayers();
        renderCustomShaderLibrary();
      };
      shaderListEl.appendChild(row);
    });
  }

  // Initial render of custom shader library
  renderCustomShaderLibrary();

  // ── Computer Keyboard → MIDI Notes ────────────────────────────────────
  // Two rows: bottom row = white keys (C3 to E5), top row = sharps
  const KEY_MAP = {
    // Bottom row — white keys
    'z': 48, 'x': 50, 'c': 52, 'v': 53, 'b': 55, 'n': 57, 'm': 59,  // C3–B3
    ',': 60, '.': 62, '/': 64,                                         // C4–E4
    // Top row — next octave white keys
    'q': 60, 'w': 62, 'e': 64, 'r': 65, 't': 67, 'y': 69, 'u': 71,  // C4–B4
    'i': 72, 'o': 74, 'p': 76,                                        // C5–E5
    // Middle row — sharps for bottom row
    's': 49, 'd': 51, 'g': 54, 'h': 56, 'j': 58,                     // C#3–A#3
    'l': 61, ';': 63,                                                  // C#4–D#4
    // Number row — sharps for top row
    '2': 61, '3': 63, '5': 66, '6': 68, '7': 70,                     // C#4–A#4
    '9': 73, '0': 75,                                                  // C#5–D#5
  };
  const keysDown = new Set();

  // ── Voice Mode Routing ────────────────────────────────────────────────
  let voiceMode = 'both'; // 'synth' | 'bass' | 'both'

  document.querySelectorAll('input[name="voice-mode"]').forEach(radio => {
    radio.onchange = function () { voiceMode = this.value; };
  });

  function voiceNoteOn(note, vel) {
    if (voiceMode === 'synth' || voiceMode === 'both') noteOn(note, vel);
    if ((voiceMode === 'bass' || voiceMode === 'both') && isBassActive()) bassNoteOn(note, vel / 127);
  }

  function voiceNoteOff(note) {
    if (voiceMode === 'synth' || voiceMode === 'both') noteOff(note);
    if ((voiceMode === 'bass' || voiceMode === 'both') && isBassActive()) bassNoteOff(note);
  }

  document.addEventListener('keydown', (e) => {
    if (!isMidiActive()) return;
    if (e.repeat) return;
    // Don't capture if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const note = KEY_MAP[e.key.toLowerCase()];
    if (note !== undefined) {
      e.preventDefault();
      keysDown.add(e.key.toLowerCase());
      voiceNoteOn(note, 100);
    }
  });

  document.addEventListener('keyup', (e) => {
    if (!isMidiActive()) return;
    const note = KEY_MAP[e.key.toLowerCase()];
    if (note !== undefined) {
      keysDown.delete(e.key.toLowerCase());
      voiceNoteOff(note);
    }
  });

  // ── Click-to-Play on Piano Visualizer ─────────────────────────────────
  const pianoCanvas = document.getElementById('midi-keyboard-viz');
  let pianoMouseDown = false;
  let lastClickedNote = -1;

  function getNoteFromClick(e) {
    const rect = pianoCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    const startNote = 36; // C2
    const endNote = 84;   // C6
    const isBlack = [false, true, false, true, false, false, true, false, true, false, true, false];

    let whiteCount = 0;
    for (let n = startNote; n < endNote; n++) {
      if (!isBlack[n % 12]) whiteCount++;
    }

    const whiteWidth = w / whiteCount;
    const blackWidth = whiteWidth * 0.6;
    const blackHeight = h * 0.6;

    // Check black keys first (they're on top)
    if (y < blackHeight) {
      let wx = 0;
      for (let n = startNote; n < endNote; n++) {
        if (isBlack[n % 12]) continue;
        if (n + 1 < endNote && isBlack[(n + 1) % 12]) {
          const bx = wx + whiteWidth - blackWidth / 2;
          if (x >= bx && x < bx + blackWidth) {
            return n + 1;
          }
        }
        wx += whiteWidth;
      }
    }

    // Check white keys
    let wx = 0;
    for (let n = startNote; n < endNote; n++) {
      if (isBlack[n % 12]) continue;
      if (x >= wx && x < wx + whiteWidth) {
        return n;
      }
      wx += whiteWidth;
    }
    return -1;
  }

  pianoCanvas.addEventListener('mousedown', (e) => {
    if (!isMidiActive()) return;
    pianoMouseDown = true;
    const note = getNoteFromClick(e);
    if (note >= 0) {
      lastClickedNote = note;
      voiceNoteOn(note, 100);
    }
  });

  pianoCanvas.addEventListener('mousemove', (e) => {
    if (!pianoMouseDown || !isMidiActive()) return;
    const note = getNoteFromClick(e);
    if (note >= 0 && note !== lastClickedNote) {
      if (lastClickedNote >= 0) voiceNoteOff(lastClickedNote);
      lastClickedNote = note;
      voiceNoteOn(note, 100);
    }
  });

  pianoCanvas.addEventListener('mouseup', () => {
    if (lastClickedNote >= 0) voiceNoteOff(lastClickedNote);
    pianoMouseDown = false;
    lastClickedNote = -1;
  });

  pianoCanvas.addEventListener('mouseleave', () => {
    if (pianoMouseDown && lastClickedNote >= 0) voiceNoteOff(lastClickedNote);
    pianoMouseDown = false;
    lastClickedNote = -1;
  });

  // ── Mouse Interaction Controls ──────────────────────────────────────────
  document.getElementById('mouse-toggle').onchange = function () {
    state.mouse.enabled = this.checked;
    state.needsRedraw = true;
  };

  document.getElementById('mouse-strength').oninput = function () {
    state.mouse.strength = parseFloat(this.value);
    document.getElementById('val-mouse-strength').textContent = state.mouse.strength.toFixed(2);
  };

  document.getElementById('mouse-mode').onchange = function () {
    state.mouse.mode = this.value;
  };

}, 100);
