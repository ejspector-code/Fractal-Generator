/**
 * Animation engine — auto-drift for attractor coefficients.
 * Supports audio-reactive modulation via setAudioModulation().
 */

export class Animator {
    constructor() {
        this.playing = false;
        this.speed = 0.003;
        this.time = 0;
        this.sensitivity = 1.0;

        // Drift: sinusoidal modulation around a base
        this.baseCoeffs = {};
        this.driftConfig = {};
        this.audioConfig = null;

        // Color shift output (driven by audio)
        this.colorShift = 0;
    }

    setBase(coeffs) {
        this.baseCoeffs = { ...coeffs };

        // Create drift config based on which keys are present
        this.driftConfig = {};
        const keys = Object.keys(coeffs);
        keys.forEach((key, i) => {
            const range = Math.abs(coeffs[key]) * 0.15 + 0.2;
            this.driftConfig[key] = {
                amplitude: range,
                frequency: 0.7 + i * 0.3,
                phase: i * 1.5,
            };
        });
    }

    play() {
        this.playing = true;
    }

    pause() {
        this.playing = false;
    }

    reset() {
        this.time = 0;
    }

    /**
     * Set audio modulation data from audioReactive analysis.
     * @param {{ bass: number, mid: number, treble: number, energy: number, beat: number } | null} config
     */
    setAudioModulation(config) {
        this.audioConfig = config;
    }

    /**
     * Advance animation and return interpolated coefficients.
     * Returns null if not playing AND no audio is active.
     */
    update() {
        const hasAudio = this.audioConfig && this.audioConfig.energy > 0.01;

        if (!this.playing && !hasAudio) return null;

        if (this.playing) {
            this.time += this.speed;
        }

        const t = this.time;
        const result = {};
        const sens = this.sensitivity;

        // ── Color Shift (audio-driven hue offset) ─────────────────────────────
        if (hasAudio) {
            const a = this.audioConfig;
            // Vivid color cycling: hue shifts dramatically with beat + treble
            this.colorShift = (a.beat * 60 + a.energy * 30 + a.treble * 20 + a.bass * 15) * sens;
        } else {
            this.colorShift *= 0.9; // Decay to zero
        }

        // ── Coefficient Modulation ────────────────────────────────────────────
        for (const key in this.baseCoeffs) {
            const dc = this.driftConfig[key];
            if (dc) {
                // Base drift (sinusoidal)
                let val = this.baseCoeffs[key];
                if (this.playing) {
                    val += Math.sin(t * dc.frequency + dc.phase) * dc.amplitude;
                }

                // Audio modulation
                if (hasAudio) {
                    const a = this.audioConfig;
                    const energy = a.energy;

                    // Bass → dramatic large-scale morph
                    if (key === 'a' || key === 'sigma') {
                        val += a.bass * 1.2 * energy * sens;
                    }
                    // Mids → strong medium detail warping
                    if (key === 'b' || key === 'rho') {
                        val += a.mid * 0.8 * energy * sens;
                    }
                    // Treble → visible fine structure shifts
                    if (key === 'c' || key === 'beta') {
                        val += a.treble * 0.5 * energy * sens;
                    }
                    // Beat → punch ALL coefficients for explosive morph
                    if (key === 'd') {
                        val += a.beat * 1.0 * energy * sens;
                    }
                    // Zoom breathing: bass + beat pulse zoom in/out
                    if (key === 'zoom') {
                        val += (a.bass * 0.5 + a.beat * 0.4) * sens;
                    }
                }

                result[key] = val;
            } else {
                result[key] = this.baseCoeffs[key];
            }
        }

        return result;
    }
}
