import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue, type MotionValue } from 'framer-motion';
import './tailwind.css';
import './i18n';
import LyricVizRoot, { type LyricVizBackgroundState, type LyricVizRuntimeState, type LyricVizTuningState } from './LyricVizRoot';
import {
    mineradioLinesToFoliaLines,
    type MineradioLyricLine,
} from './adapter';
import { mapMineradioTheme, type MineradioLyricThemeInput } from './theme-mapper';
import type { AudioBands, Line, Theme, VisualizerMode } from './types';
import { DEFAULT_CLASSIC_TUNING } from './types';

export type { MineradioLyricLine, LyricVizBackgroundState, LyricVizTuningState, LyricVizRuntimeState };

const createAudioBands = (): AudioBands => ({
    bass: motionValue(0),
    lowMid: motionValue(0),
    mid: motionValue(0),
    vocal: motionValue(0),
    treble: motionValue(0),
});

const isFullTheme = (theme: Theme | MineradioLyricThemeInput): theme is Theme => (
    typeof (theme as Theme).primaryColor === 'string'
    && typeof (theme as Theme).backgroundColor === 'string'
);

const createDefaultState = (target: 'stage' | 'desktop'): LyricVizRuntimeState => ({
    mode: 'off',
    lines: [],
    theme: mapMineradioTheme(),
    visible: false,
    paused: false,
    lyricsFontScale: target === 'desktop' ? 0.72 : 1,
    lyricsLetterSpacing: 0,
    lyricsLineHeight: 1,
    lyricsFontWeight: 700,
    visualizerOpacity: 1,
    staticMode: false,
    coverUrl: null,
    songTitle: null,
    songArtist: null,
    songAlbum: null,
    tuning: {},
    background: {},
    target,
});

class LyricVizInstance {
    host: HTMLElement;
    root: Root | null = null;
    currentTime: MotionValue<number> = motionValue(0);
    audioPower: MotionValue<number> = motionValue(0);
    audioBands: AudioBands = createAudioBands();
    state: LyricVizRuntimeState;

    constructor(host: HTMLElement, target: 'stage' | 'desktop') {
        this.host = host;
        this.audioBands = createAudioBands();
        this.state = createDefaultState(target);
    }

    private render() {
        if (!this.root) return;
        this.root.render(
            <LyricVizRoot
                state={this.state}
                currentTime={this.currentTime}
                audioPower={this.audioPower}
                audioBands={this.audioBands}
            />,
        );
    }

    mount() {
        if (!this.root) {
            this.root = createRoot(this.host);
        }
        this.render();
        return this;
    }

    destroy() {
        if (this.root) {
            this.root.unmount();
            this.root = null;
        }
    }

    setMode(mode: VisualizerMode | 'off') {
        this.state.mode = mode;
        if (mode === 'off') {
            this.state.visible = false;
        }
        this.render();
    }

    setLines(lines: Line[] | MineradioLyricLine[]) {
        if (!lines.length) {
            this.state.lines = [];
        } else if ('fullText' in (lines[0] as Line)) {
            this.state.lines = lines as Line[];
        } else {
            this.state.lines = mineradioLinesToFoliaLines(lines as MineradioLyricLine[]);
        }
        this.render();
    }

    setTime(seconds: number) {
        this.currentTime.set(Number(seconds) || 0);
    }

    setAudio(payload: { power?: number; bands?: Partial<{ bass: number; mid: number; treble: number }> }) {
        if (typeof payload.power === 'number') {
            this.audioPower.set(payload.power);
        }
        if (payload.bands) {
            const bass = typeof payload.bands.bass === 'number' ? payload.bands.bass : 0;
            const mid = typeof payload.bands.mid === 'number' ? payload.bands.mid : 0;
            const treble = typeof payload.bands.treble === 'number' ? payload.bands.treble : 0;
            // Mineradio sends normalized 0-1 bands; folia visualizers expect 0-255 MotionValues.
            this.audioBands.bass.set(bass * 255);
            this.audioBands.lowMid.set((bass * 0.55 + mid * 0.45) * 255);
            this.audioBands.mid.set(mid * 255);
            this.audioBands.vocal.set((mid * 0.85 + treble * 0.15) * 255);
            this.audioBands.treble.set(treble * 255);
        }
    }

    setTheme(theme: Theme | MineradioLyricThemeInput) {
        this.state.theme = isFullTheme(theme)
            ? theme
            : mapMineradioTheme(theme);
        this.render();
    }

    setTuning(tuning: LyricVizTuningState) {
        this.state.tuning = { ...this.state.tuning, ...tuning };
        this.render();
    }

    setBackground(background: LyricVizBackgroundState) {
        this.state.background = { ...background };
        this.render();
    }

    setMeta(payload: {
        coverUrl?: string | null;
        songTitle?: string | null;
        songArtist?: string | null;
        songAlbum?: string | null;
        lyricsFontScale?: number;
        lyricsLetterSpacing?: number;
        lyricsLineHeight?: number;
        lyricsFontWeight?: number;
        visualizerOpacity?: number;
        staticMode?: boolean;
        animationIntensity?: 'calm' | 'normal' | 'chaotic';
    }) {
        if (payload.coverUrl !== undefined) this.state.coverUrl = payload.coverUrl;
        if (payload.songTitle !== undefined) this.state.songTitle = payload.songTitle;
        if (payload.songArtist !== undefined) this.state.songArtist = payload.songArtist;
        if (payload.songAlbum !== undefined) this.state.songAlbum = payload.songAlbum;
        if (typeof payload.lyricsFontScale === 'number') this.state.lyricsFontScale = payload.lyricsFontScale;
        if (typeof payload.lyricsLetterSpacing === 'number') this.state.lyricsLetterSpacing = payload.lyricsLetterSpacing;
        if (typeof payload.lyricsLineHeight === 'number') this.state.lyricsLineHeight = payload.lyricsLineHeight;
        if (typeof payload.lyricsFontWeight === 'number') this.state.lyricsFontWeight = payload.lyricsFontWeight;
        if (typeof payload.visualizerOpacity === 'number') this.state.visualizerOpacity = payload.visualizerOpacity;
        if (typeof payload.staticMode === 'boolean') this.state.staticMode = payload.staticMode;
        if (payload.animationIntensity) {
            this.state.theme = {
                ...this.state.theme,
                animationIntensity: payload.animationIntensity,
            };
        }
        this.render();
    }

    setVisible(visible: boolean) {
        this.state.visible = visible && this.state.mode !== 'off';
        this.render();
    }

    setPaused(paused: boolean) {
        if (this.state.paused === paused) return;
        this.state.paused = paused;
        this.render();
    }
}

const instances = new WeakMap<HTMLElement, LyricVizInstance>();

export interface MineradioLyricVizApi {
    mount: (hostEl: HTMLElement, options?: { target?: 'stage' | 'desktop'; transparent?: boolean }) => LyricVizInstance;
    setMode: (hostEl: HTMLElement, mode: VisualizerMode | 'off') => void;
    setLines: (hostEl: HTMLElement, lines: Line[] | MineradioLyricLine[]) => void;
    setTime: (hostEl: HTMLElement, seconds: number) => void;
    setAudio: (hostEl: HTMLElement, payload: { power?: number; bands?: Partial<{ bass: number; mid: number; treble: number }> }) => void;
    setTheme: (hostEl: HTMLElement, theme: Theme | MineradioLyricThemeInput) => void;
    setTuning: (hostEl: HTMLElement, tuning: LyricVizTuningState) => void;
    setBackground: (hostEl: HTMLElement, background: LyricVizBackgroundState) => void;
    setMeta: (hostEl: HTMLElement, payload: Parameters<LyricVizInstance['setMeta']>[0]) => void;
    setVisible: (hostEl: HTMLElement, visible: boolean) => void;
    setPaused: (hostEl: HTMLElement, paused: boolean) => void;
    destroy: (hostEl: HTMLElement) => void;
    getInstance: (hostEl: HTMLElement) => LyricVizInstance | undefined;
    DEFAULT_CLASSIC_TUNING: typeof DEFAULT_CLASSIC_TUNING;
}

function resolve(hostEl: HTMLElement) {
    const instance = instances.get(hostEl);
    if (!instance) {
        throw new Error('MineradioLyricViz: host is not mounted');
    }
    return instance;
}

export const MineradioLyricViz: MineradioLyricVizApi = {
    mount(hostEl, options = {}) {
        const target = options.target || 'stage';
        let instance = instances.get(hostEl);
        if (!instance) {
            instance = new LyricVizInstance(hostEl, target);
            instances.set(hostEl, instance);
        }
        hostEl.classList.add('mineradio-lyric-viz-host');
        if (options.transparent !== false) {
            hostEl.style.background = 'transparent';
        }
        return instance.mount();
    },
    setMode(hostEl, mode) { resolve(hostEl).setMode(mode); },
    setLines(hostEl, lines) { resolve(hostEl).setLines(lines); },
    setTime(hostEl, seconds) { resolve(hostEl).setTime(seconds); },
    setAudio(hostEl, payload) { resolve(hostEl).setAudio(payload); },
    setTheme(hostEl, theme) { resolve(hostEl).setTheme(theme); },
    setTuning(hostEl, tuning) { resolve(hostEl).setTuning(tuning); },
    setBackground(hostEl, background) { resolve(hostEl).setBackground(background); },
    setMeta(hostEl, payload) { resolve(hostEl).setMeta(payload); },
    setVisible(hostEl, visible) { resolve(hostEl).setVisible(visible); },
    setPaused(hostEl, paused) { resolve(hostEl).setPaused(paused); },
    destroy(hostEl) {
        const instance = instances.get(hostEl);
        if (instance) {
            instance.destroy();
            instances.delete(hostEl);
        }
    },
    getInstance(hostEl) { return instances.get(hostEl); },
    DEFAULT_CLASSIC_TUNING,
};

declare global {
    interface Window {
        MineradioLyricViz?: MineradioLyricVizApi;
    }
}

if (typeof window !== 'undefined') {
    window.MineradioLyricViz = MineradioLyricViz;
}

export default MineradioLyricViz;
