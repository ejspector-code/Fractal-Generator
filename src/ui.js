/**
 * UI Controller — wires DOM controls to app state.
 * Supports de Jong, Clifford, Lorenz, Aizawa, Buddhabrot, Burning Ship, and Curl Noise.
 */
import { DEJONG_PRESETS, CLIFFORD_PRESETS, LORENZ_PRESETS, AIZAWA_PRESETS, BUDDHABROT_PRESETS, BURNINGSHIP_PRESETS, CURLNOISE_PRESETS, COLOR_PALETTES } from './presets.js';
import { resetParticles } from './renderer.js';

/**
 * Initialize all UI controls.
 */
export function initUI(state, onStateChange, animator) {

    const $ = (id) => document.getElementById(id);
    const setVal = (id, val) => {
        const el = $(id);
        if (el) el.textContent = typeof val === 'number' ? val.toFixed(2) : val;
    };


    // ── Seed ────────────────────────────────────────────────────────────────────
    const updateSeedDisplay = () => $('seed-display').textContent = state.seed;

    $('seed-prev').onclick = () => { state.seed--; updateSeedDisplay(); onStateChange('seed'); };
    $('seed-next').onclick = () => { state.seed++; updateSeedDisplay(); onStateChange('seed'); };
    $('seed-random').onclick = () => {
        state.seed = Math.floor(Math.random() * 99999);
        updateSeedDisplay();
        onStateChange('seed');
    };
    $('seed-go').onclick = () => {
        const v = parseInt($('seed-input').value);
        if (!isNaN(v)) { state.seed = v; updateSeedDisplay(); onStateChange('seed'); }
    };
    $('seed-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('seed-go').click();
    });

    // ── All coefficient panel IDs ───────────────────────────────────────────────
    const allPanels = [
        'dejong-coeffs', 'clifford-coeffs', 'lorenz-coeffs', 'aizawa-coeffs',
        'buddhabrot-coeffs', 'burningship-coeffs', 'curlnoise-coeffs'
    ];

    const panelMap = {
        dejong: 'dejong-coeffs',
        clifford: 'clifford-coeffs',
        lorenz: 'lorenz-coeffs',
        aizawa: 'aizawa-coeffs',
        buddhabrot: 'buddhabrot-coeffs',
        burningship: 'burningship-coeffs',
        curlnoise: 'curlnoise-coeffs',
    };

    // ── Attractor Type ──────────────────────────────────────────────────────────
    const subtitleMap = {
        dejong: 'Peter de Jong Attractor',
        clifford: 'Clifford Attractor',
        lorenz: 'Lorenz Attractor',
        aizawa: 'Aizawa Attractor',
        buddhabrot: 'Buddhabrot',
        burningship: 'Burning Ship',
        curlnoise: 'Curl Noise Flow Field',
    };

    $('attractor-type').onchange = function () {
        state.attractorType = this.value;

        // Toggle coefficient panels — show only the active one
        allPanels.forEach(id => {
            $(id).style.display = 'none';
        });
        const activePanel = panelMap[this.value];
        if (activePanel) $(activePanel).style.display = '';

        // Update subtitle
        $('attractor-subtitle').textContent = subtitleMap[this.value] || 'Strange Attractors';

        // Rebuild presets
        buildPresets();
        resetParticles();

        // Set animator base
        const base = getAnimatorBase(this.value);
        animator.setBase(base);

        onStateChange('attractor');
    };

    /** Get the correct coefficients object for the animator based on type */
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
            default: return state.coeffs;
        }
    }

    // ── Canvas Aspect Ratio ─────────────────────────────────────────────────────
    $('canvas-aspect').onchange = function () {
        state.aspectRatio = this.value;
        resetParticles();
        onStateChange('aspect');
    };

    // ── Presets ─────────────────────────────────────────────────────────────────
    const presetsGrid = $('presets-grid');

    const presetMap = {
        dejong: DEJONG_PRESETS,
        clifford: CLIFFORD_PRESETS,
        lorenz: LORENZ_PRESETS,
        aizawa: AIZAWA_PRESETS,
        buddhabrot: BUDDHABROT_PRESETS,
        burningship: BURNINGSHIP_PRESETS,
        curlnoise: CURLNOISE_PRESETS,
    };

    function buildPresets() {
        presetsGrid.innerHTML = '';
        const presets = presetMap[state.attractorType] || DEJONG_PRESETS;

        presets.forEach((preset) => {
            const btn = document.createElement('button');
            btn.className = 'preset-btn';
            btn.textContent = preset.name;
            btn.onclick = () => {
                applyPreset(preset);
                resetParticles();
                onStateChange('coeffs');
                presetsGrid.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            };
            presetsGrid.appendChild(btn);
        });
    }

    function applyPreset(preset) {
        switch (state.attractorType) {
            case 'lorenz':
                state.lorenzCoeffs = { sigma: preset.sigma, rho: preset.rho, beta: preset.beta };
                syncLorenzSliders();
                animator.setBase(state.lorenzCoeffs);
                break;
            case 'aizawa':
                state.aizawaCoeffs = { a: preset.a, b: preset.b, c: preset.c, d: preset.d, e: preset.e, f: preset.f };
                syncAizawaSliders();
                animator.setBase(state.aizawaCoeffs);
                break;
            case 'clifford':
                state.cliffordCoeffs = { a: preset.a, b: preset.b, c: preset.c, d: preset.d };
                syncCliffordSliders();
                animator.setBase(state.cliffordCoeffs);
                break;
            case 'buddhabrot':
                state.buddhabrotParams = { ...state.buddhabrotParams, ...preset };
                syncBuddhabrotSliders();
                break;
            case 'burningship':
                state.burningShipParams = { ...state.burningShipParams, ...preset };
                syncBurningShipSliders();
                break;
            case 'curlnoise':
                state.curlNoiseParams = { ...preset };
                syncCurlNoiseSliders();
                animator.setBase({ ...state.curlNoiseParams });
                break;
            default:
                state.coeffs = { a: preset.a, b: preset.b, c: preset.c, d: preset.d };
                syncCoeffSliders();
                animator.setBase(state.coeffs);
                break;
        }
    }

    // ── De Jong Coefficients ────────────────────────────────────────────────────
    const coeffSliders = ['a', 'b', 'c', 'd'];

    function syncCoeffSliders() {
        coeffSliders.forEach(k => {
            $(`coeff-${k}`).value = state.coeffs[k];
            setVal(`val-${k}`, state.coeffs[k]);
        });
    }

    coeffSliders.forEach(k => {
        $(`coeff-${k}`).oninput = function () {
            state.coeffs[k] = parseFloat(this.value);
            setVal(`val-${k}`, state.coeffs[k]);
            resetParticles();
            onStateChange('coeffs');
        };
    });

    $('randomize-btn').onclick = () => {
        coeffSliders.forEach(k => {
            state.coeffs[k] = (Math.random() * 6.28) - 3.14;
        });
        syncCoeffSliders();
        animator.setBase(state.coeffs);
        resetParticles();
        onStateChange('coeffs');
        presetsGrid.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    };

    // ── Clifford Coefficients ──────────────────────────────────────────────────
    const cliffordKeys = ['a', 'b', 'c', 'd'];

    function syncCliffordSliders() {
        cliffordKeys.forEach(k => {
            $(`coeff-cliff-${k}`).value = state.cliffordCoeffs[k];
            setVal(`val-cliff-${k}`, state.cliffordCoeffs[k]);
        });
    }

    cliffordKeys.forEach(k => {
        $(`coeff-cliff-${k}`).oninput = function () {
            state.cliffordCoeffs[k] = parseFloat(this.value);
            setVal(`val-cliff-${k}`, state.cliffordCoeffs[k]);
            resetParticles();
            onStateChange('coeffs');
        };
    });

    $('randomize-clifford-btn').onclick = () => {
        state.cliffordCoeffs.a = (Math.random() * 4) - 2;
        state.cliffordCoeffs.b = (Math.random() * 4) - 2;
        state.cliffordCoeffs.c = (Math.random() * 3) - 1.5;
        state.cliffordCoeffs.d = (Math.random() * 3) - 1.5;
        syncCliffordSliders();
        animator.setBase(state.cliffordCoeffs);
        resetParticles();
        onStateChange('coeffs');
        presetsGrid.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    };

    // ── Lorenz Coefficients ─────────────────────────────────────────────────────
    function syncLorenzSliders() {
        $('coeff-sigma').value = state.lorenzCoeffs.sigma;
        setVal('val-sigma', state.lorenzCoeffs.sigma);
        $('coeff-rho').value = state.lorenzCoeffs.rho;
        setVal('val-rho', state.lorenzCoeffs.rho);
        $('coeff-beta').value = state.lorenzCoeffs.beta;
        setVal('val-beta', state.lorenzCoeffs.beta);
    }

    $('coeff-sigma').oninput = function () {
        state.lorenzCoeffs.sigma = parseFloat(this.value);
        setVal('val-sigma', state.lorenzCoeffs.sigma);
        resetParticles();
        onStateChange('coeffs');
    };

    $('coeff-rho').oninput = function () {
        state.lorenzCoeffs.rho = parseFloat(this.value);
        setVal('val-rho', state.lorenzCoeffs.rho);
        resetParticles();
        onStateChange('coeffs');
    };

    $('coeff-beta').oninput = function () {
        state.lorenzCoeffs.beta = parseFloat(this.value);
        setVal('val-beta', state.lorenzCoeffs.beta);
        resetParticles();
        onStateChange('coeffs');
    };

    $('randomize-lorenz-btn').onclick = () => {
        state.lorenzCoeffs.sigma = Math.random() * 20 + 2;
        state.lorenzCoeffs.rho = Math.random() * 80 + 10;
        state.lorenzCoeffs.beta = Math.random() * 6 + 0.5;
        syncLorenzSliders();
        animator.setBase(state.lorenzCoeffs);
        resetParticles();
        onStateChange('coeffs');
        presetsGrid.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    };

    // ── Aizawa Coefficients ─────────────────────────────────────────────────────
    const aizawaKeys = ['a', 'b', 'c', 'd', 'e', 'f'];

    function syncAizawaSliders() {
        aizawaKeys.forEach(k => {
            $(`coeff-aiz-${k}`).value = state.aizawaCoeffs[k];
            setVal(`val-aiz-${k}`, state.aizawaCoeffs[k]);
        });
    }

    aizawaKeys.forEach(k => {
        $(`coeff-aiz-${k}`).oninput = function () {
            state.aizawaCoeffs[k] = parseFloat(this.value);
            setVal(`val-aiz-${k}`, state.aizawaCoeffs[k]);
            resetParticles();
            onStateChange('coeffs');
        };
    });

    $('randomize-aizawa-btn').onclick = () => {
        state.aizawaCoeffs.a = 0.5 + Math.random() * 0.8;
        state.aizawaCoeffs.b = 0.3 + Math.random() * 0.6;
        state.aizawaCoeffs.c = 0.3 + Math.random() * 0.6;
        state.aizawaCoeffs.d = 2.0 + Math.random() * 3.0;
        state.aizawaCoeffs.e = 0.05 + Math.random() * 0.5;
        state.aizawaCoeffs.f = 0.02 + Math.random() * 0.2;
        syncAizawaSliders();
        animator.setBase(state.aizawaCoeffs);
        resetParticles();
        onStateChange('coeffs');
        presetsGrid.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    };

    // ── Buddhabrot Controls ─────────────────────────────────────────────────────
    function syncBuddhabrotSliders() {
        const bp = state.buddhabrotParams;
        if (!bp) return;
        $('bb-maxiter').value = bp.maxIter;
        setVal('val-bb-maxiter', bp.maxIter);

        // Samples slider is log-scale
        const samplesLog = Math.log10(bp.samples);
        $('bb-samples').value = samplesLog;
        const label = bp.samples >= 1_000_000 ? (bp.samples / 1_000_000).toFixed(1) + 'M' : (bp.samples / 1000).toFixed(0) + 'K';
        $('val-bb-samples').textContent = label;

        $('bb-anti').checked = bp.anti;

        $('bb-zoom').value = bp.zoom;
        setVal('val-bb-zoom', bp.zoom);

        $('bb-center-x').value = bp.centerX;
        setVal('val-bb-cx', bp.centerX);

        $('bb-center-y').value = bp.centerY;
        setVal('val-bb-cy', bp.centerY);
    }

    $('bb-maxiter').oninput = function () {
        state.buddhabrotParams.maxIter = parseInt(this.value);
        setVal('val-bb-maxiter', parseInt(this.value));
        resetParticles();
        onStateChange('buddhabrot');
    };

    $('bb-samples').oninput = function () {
        const count = Math.round(Math.pow(10, parseFloat(this.value)));
        state.buddhabrotParams.samples = count;
        const label = count >= 1_000_000 ? (count / 1_000_000).toFixed(1) + 'M' : (count / 1000).toFixed(0) + 'K';
        $('val-bb-samples').textContent = label;
        onStateChange('buddhabrot');
    };

    $('bb-anti').onchange = function () {
        state.buddhabrotParams.anti = this.checked;
        resetParticles();
        onStateChange('buddhabrot');
    };

    $('bb-zoom').oninput = function () {
        state.buddhabrotParams.zoom = parseFloat(this.value);
        setVal('val-bb-zoom', state.buddhabrotParams.zoom);
        resetParticles();
        onStateChange('buddhabrot');
    };

    $('bb-center-x').oninput = function () {
        state.buddhabrotParams.centerX = parseFloat(this.value);
        setVal('val-bb-cx', state.buddhabrotParams.centerX);
        resetParticles();
        onStateChange('buddhabrot');
    };

    $('bb-center-y').oninput = function () {
        state.buddhabrotParams.centerY = parseFloat(this.value);
        setVal('val-bb-cy', state.buddhabrotParams.centerY);
        resetParticles();
        onStateChange('buddhabrot');
    };

    // ── Burning Ship Controls ───────────────────────────────────────────────────
    function syncBurningShipSliders() {
        const bp = state.burningShipParams;
        if (!bp) return;
        $('bs-maxiter').value = bp.maxIter;
        setVal('val-bs-maxiter', bp.maxIter);

        const samplesLog = Math.log10(bp.samples);
        $('bs-samples').value = samplesLog;
        const label = bp.samples >= 1_000_000 ? (bp.samples / 1_000_000).toFixed(1) + 'M' : (bp.samples / 1000).toFixed(0) + 'K';
        $('val-bs-samples').textContent = label;

        $('bs-anti').checked = bp.anti;
        $('bs-zoom').value = bp.zoom;
        setVal('val-bs-zoom', bp.zoom);
        $('bs-center-x').value = bp.centerX;
        setVal('val-bs-cx', bp.centerX);
        $('bs-center-y').value = bp.centerY;
        setVal('val-bs-cy', bp.centerY);
    }

    $('bs-maxiter').oninput = function () {
        state.burningShipParams.maxIter = parseInt(this.value);
        setVal('val-bs-maxiter', parseInt(this.value));
        resetParticles();
        onStateChange('burningship');
    };

    $('bs-samples').oninput = function () {
        const count = Math.round(Math.pow(10, parseFloat(this.value)));
        state.burningShipParams.samples = count;
        const label = count >= 1_000_000 ? (count / 1_000_000).toFixed(1) + 'M' : (count / 1000).toFixed(0) + 'K';
        $('val-bs-samples').textContent = label;
        onStateChange('burningship');
    };

    $('bs-anti').onchange = function () {
        state.burningShipParams.anti = this.checked;
        resetParticles();
        onStateChange('burningship');
    };

    $('bs-zoom').oninput = function () {
        state.burningShipParams.zoom = parseFloat(this.value);
        setVal('val-bs-zoom', state.burningShipParams.zoom);
        resetParticles();
        onStateChange('burningship');
    };

    $('bs-center-x').oninput = function () {
        state.burningShipParams.centerX = parseFloat(this.value);
        setVal('val-bs-cx', state.burningShipParams.centerX);
        resetParticles();
        onStateChange('burningship');
    };

    $('bs-center-y').oninput = function () {
        state.burningShipParams.centerY = parseFloat(this.value);
        setVal('val-bs-cy', state.burningShipParams.centerY);
        resetParticles();
        onStateChange('burningship');
    };

    // ── Curl Noise Controls ─────────────────────────────────────────────────────
    function syncCurlNoiseSliders() {
        const cn = state.curlNoiseParams;
        if (!cn) return;
        $('cn-scale').value = cn.scale;
        setVal('val-cn-scale', cn.scale);
        $('cn-octaves').value = cn.octaves;
        $('val-cn-octaves').textContent = cn.octaves;
        $('cn-lacunarity').value = cn.lacunarity;
        setVal('val-cn-lacunarity', cn.lacunarity);
        $('cn-gain').value = cn.gain;
        setVal('val-cn-gain', cn.gain);
        $('cn-speed').value = cn.speed;
        setVal('val-cn-speed', cn.speed);
    }

    $('cn-scale').oninput = function () {
        state.curlNoiseParams.scale = parseFloat(this.value);
        setVal('val-cn-scale', state.curlNoiseParams.scale);
        resetParticles();
        onStateChange('curlnoise');
    };

    $('cn-octaves').oninput = function () {
        state.curlNoiseParams.octaves = parseInt(this.value);
        $('val-cn-octaves').textContent = this.value;
        resetParticles();
        onStateChange('curlnoise');
    };

    $('cn-lacunarity').oninput = function () {
        state.curlNoiseParams.lacunarity = parseFloat(this.value);
        setVal('val-cn-lacunarity', state.curlNoiseParams.lacunarity);
        resetParticles();
        onStateChange('curlnoise');
    };

    $('cn-gain').oninput = function () {
        state.curlNoiseParams.gain = parseFloat(this.value);
        setVal('val-cn-gain', state.curlNoiseParams.gain);
        resetParticles();
        onStateChange('curlnoise');
    };

    $('cn-speed').oninput = function () {
        state.curlNoiseParams.speed = parseFloat(this.value);
        setVal('val-cn-speed', state.curlNoiseParams.speed);
        resetParticles();
        onStateChange('curlnoise');
    };

    $('randomize-curlnoise-btn').onclick = () => {
        state.curlNoiseParams.scale = 0.5 + Math.random() * 4;
        state.curlNoiseParams.octaves = 1 + Math.floor(Math.random() * 7);
        state.curlNoiseParams.lacunarity = 1.2 + Math.random() * 2.5;
        state.curlNoiseParams.gain = 0.2 + Math.random() * 0.6;
        state.curlNoiseParams.speed = 0.1 + Math.random() * 1.5;
        syncCurlNoiseSliders();
        animator.setBase({ ...state.curlNoiseParams });
        resetParticles();
        onStateChange('curlnoise');
        presetsGrid.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    };

    // ── Render Mode ─────────────────────────────────────────────────────────────
    $('render-mode').onchange = function () {
        state.renderMode = this.value;
        $('classic-controls').style.display = this.value === 'classic' ? 'block' : 'none';
        $('particle-controls').style.display = this.value === 'particles' ? 'block' : 'none';
        $('vapor-controls').style.display = this.value === 'vapor' ? 'block' : 'none';
        // Show blend mode only for particles/vapor
        $('blend-mode-group').style.display = (this.value === 'particles' || this.value === 'vapor') ? '' : 'none';
        resetParticles();
        onStateChange('renderMode');
    };

    // ── Classic controls ────────────────────────────────────────────────────────
    $('iterations').oninput = function () {
        state.classicParams.iterationsPow = parseFloat(this.value);
        const n = Math.round(Math.pow(10, state.classicParams.iterationsPow));
        const label = n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : (n / 1000).toFixed(0) + 'K';
        setVal('val-iterations', label);
        onStateChange('classic');
    };

    $('density-mode').onchange = function () {
        state.classicParams.densityMode = this.value;
        onStateChange('classic');
    };

    // ── Particle controls ───────────────────────────────────────────────────────
    $('particle-count').oninput = function () {
        state.particleParams.count = parseInt(this.value);
        setVal('val-pcount', this.value);
        resetParticles();
        onStateChange('particles');
    };

    $('trail-length').oninput = function () {
        state.particleParams.trail = parseFloat(this.value);
        setVal('val-trail', state.particleParams.trail);
    };

    $('glow-intensity').oninput = function () {
        state.particleParams.glow = parseFloat(this.value);
        setVal('val-glow', state.particleParams.glow);
    };

    $('particle-size').oninput = function () {
        state.particleParams.size = parseFloat(this.value);
        setVal('val-psize', state.particleParams.size);
    };

    // ── Vapor controls ──────────────────────────────────────────────────────────
    $('vapor-count').oninput = function () {
        state.vaporParams.count = parseInt(this.value);
        setVal('val-vpcount', this.value);
        resetParticles();
        onStateChange('vapor');
    };

    $('blur-passes').oninput = function () {
        state.vaporParams.blurPasses = parseInt(this.value);
        setVal('val-blur', this.value);
    };

    $('turbulence').oninput = function () {
        state.vaporParams.turbulence = parseFloat(this.value);
        setVal('val-turb', state.vaporParams.turbulence);
    };

    $('dissipation').oninput = function () {
        state.vaporParams.dissipation = parseFloat(this.value);
        setVal('val-dissipation', state.vaporParams.dissipation);
    };

    // ── Colors ──────────────────────────────────────────────────────────────────
    $('color-mode').onchange = function () {
        state.colorParams.mode = this.value;
        // Show color pickers for dual, single, and vivid (vivid derives from colorA/colorB)
        $('color-pickers').style.display = this.value === 'spectral' ? 'none' : 'grid';
        resetParticles();
        onStateChange('color');
    };

    $('color-a').oninput = function () {
        state.colorParams.colorA = this.value;
        onStateChange('color');
    };

    $('color-b').oninput = function () {
        state.colorParams.colorB = this.value;
        onStateChange('color');
    };

    $('bg-color').oninput = function () {
        state.bgColor = this.value;
        onStateChange('bg');
    };

    // Blend mode (additive vs normal)
    $('blend-mode').onchange = function () {
        state.colorParams.blendMode = this.value;
        onStateChange('color');
    };

    $('color-pickers').style.display = 'none';

    // ── Symmetry / Kaleidoscope ──────────────────────────────────────────────────
    $('symmetry-folds').onchange = function () {
        state.symmetry.folds = parseInt(this.value);
        resetParticles();
        onStateChange('symmetry');
    };

    // ── Color Palettes ──────────────────────────────────────────────────────────
    function buildPaletteGrid() {
        const grid = $('palette-grid');
        if (!grid) return;
        grid.innerHTML = '';

        COLOR_PALETTES.forEach((palette) => {
            const btn = document.createElement('button');
            btn.className = 'palette-swatch';
            btn.innerHTML = `
                <span class="palette-dots">
                    <span class="palette-dot" style="background:${palette.colorA}"></span>
                    <span class="palette-dot" style="background:${palette.colorB}"></span>
                    <span class="palette-dot" style="background:${palette.bg}"></span>
                </span>
                ${palette.name}
            `;
            btn.onclick = () => {
                state.colorParams.colorA = palette.colorA;
                state.colorParams.colorB = palette.colorB;
                state.bgColor = palette.bg;

                // Auto-switch to dual mode so both colors are actually used
                state.colorParams.mode = 'dual';
                $('color-mode').value = 'dual';
                $('color-pickers').style.display = 'grid';

                // Sync the color pickers
                $('color-a').value = palette.colorA;
                $('color-b').value = palette.colorB;
                $('bg-color').value = palette.bg;

                // Highlight active
                grid.querySelectorAll('.palette-swatch').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                resetParticles();
                onStateChange('color');
            };
            grid.appendChild(btn);
        });
    }
    buildPaletteGrid();

    // ── Post-Processing ─────────────────────────────────────────────────────────
    const ppFilters = ['bloom', 'chromatic', 'vignette', 'grain', 'scanlines'];

    ppFilters.forEach(filter => {
        const toggle = $(`pp-${filter}`);
        const slider = $(`pp-${filter}-strength`);
        const valEl = $(`val-pp-${filter}`);

        if (toggle) {
            toggle.onchange = function () {
                state.postProcess[filter].enabled = this.checked;
                onStateChange('postProcess');
            };
        }

        if (slider) {
            slider.oninput = function () {
                state.postProcess[filter].strength = parseFloat(this.value);
                if (valEl) valEl.textContent = parseFloat(this.value).toFixed(2);
                onStateChange('postProcess');
            };
        }
    });

    // ── Diffusion ───────────────────────────────────────────────────────────────
    $('diffusion-toggle').onchange = function () {
        state.diffusion.enabled = this.checked;
        onStateChange('diffusion');
    };

    $('diffusion-strength').oninput = function () {
        state.diffusion.strength = parseFloat(this.value);
        setVal('val-diffusion', state.diffusion.strength);
        onStateChange('diffusion');
    };

    // ── Animation ───────────────────────────────────────────────────────────────
    $('auto-animate').onchange = function () {
        if (this.checked) {
            const base = getAnimatorBase(state.attractorType);
            animator.setBase(base);
            animator.play();
            $('btn-play').style.display = 'none';
            $('btn-pause').style.display = '';
        } else {
            animator.pause();
            $('btn-play').style.display = '';
            $('btn-pause').style.display = 'none';
        }
    };

    $('anim-speed').oninput = function () {
        animator.speed = parseFloat(this.value);
        setVal('val-speed', animator.speed);
    };

    $('btn-play').onclick = () => {
        $('auto-animate').checked = true;
        $('auto-animate').onchange();
    };

    $('btn-pause').onclick = () => {
        $('auto-animate').checked = false;
        $('auto-animate').onchange();
    };

    // ── Actions ─────────────────────────────────────────────────────────────────
    $('btn-reset').onclick = () => {
        const defaultPresets = {
            dejong: DEJONG_PRESETS[0],
            clifford: CLIFFORD_PRESETS[0],
            lorenz: LORENZ_PRESETS[0],
            aizawa: AIZAWA_PRESETS[0],
            buddhabrot: BUDDHABROT_PRESETS[0],
            burningship: BURNINGSHIP_PRESETS[0],
            curlnoise: CURLNOISE_PRESETS[0],
        };

        const p = defaultPresets[state.attractorType] || DEJONG_PRESETS[0];

        switch (state.attractorType) {
            case 'lorenz':
                state.lorenzCoeffs = { sigma: p.sigma, rho: p.rho, beta: p.beta };
                syncLorenzSliders();
                animator.setBase(state.lorenzCoeffs);
                break;
            case 'aizawa':
                state.aizawaCoeffs = { a: p.a, b: p.b, c: p.c, d: p.d, e: p.e, f: p.f };
                syncAizawaSliders();
                animator.setBase(state.aizawaCoeffs);
                break;
            case 'clifford':
                state.cliffordCoeffs = { a: p.a, b: p.b, c: p.c, d: p.d };
                syncCliffordSliders();
                animator.setBase(state.cliffordCoeffs);
                break;
            case 'buddhabrot':
                state.buddhabrotParams = { ...p };
                syncBuddhabrotSliders();
                animator.setBase({ maxIter: p.maxIter, zoom: p.zoom, centerX: p.centerX, centerY: p.centerY });
                break;
            case 'burningship':
                state.burningShipParams = { ...p };
                syncBurningShipSliders();
                animator.setBase({ maxIter: p.maxIter, zoom: p.zoom, centerX: p.centerX, centerY: p.centerY });
                break;
            case 'curlnoise':
                state.curlNoiseParams = { ...p };
                syncCurlNoiseSliders();
                animator.setBase({ ...state.curlNoiseParams });
                break;
            default:
                state.coeffs = { a: p.a, b: p.b, c: p.c, d: p.d };
                syncCoeffSliders();
                animator.setBase(state.coeffs);
                break;
        }

        animator.pause();
        animator.reset();
        $('auto-animate').checked = false;
        $('btn-play').style.display = '';
        $('btn-pause').style.display = 'none';
        resetParticles();
        onStateChange('reset');
        presetsGrid.querySelectorAll('.preset-btn').forEach((b, i) => {
            b.classList.toggle('active', i === 0);
        });
    };

    // Initial sync
    buildPresets();
    syncCoeffSliders();
    syncCliffordSliders();
    syncLorenzSliders();
    syncAizawaSliders();
    syncBuddhabrotSliders();
    syncBurningShipSliders();
    syncCurlNoiseSliders();
    updateSeedDisplay();

    return {
        syncCoeffSliders, syncCliffordSliders, syncLorenzSliders,
        syncAizawaSliders, syncBuddhabrotSliders, syncBurningShipSliders,
        syncCurlNoiseSliders,
    };
}
