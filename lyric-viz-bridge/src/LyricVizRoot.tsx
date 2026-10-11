import React, { useEffect, useMemo, useState } from 'react';
import { MotionValue } from 'framer-motion';
import VisualizerRenderer from './components/visualizer/VisualizerRenderer';
import type {
    AudioBands,
    CappellaTuning,
    CadenzaTuning,
    ClassicTuning,
    FumeTuning,
    Line,
    MonetTuning,
    CladdaghTuning,
    PendoloTuning,
    SonnetTuning,
    TemperaTuning,
    LumiereTuning,
    DioramaTuning,
    MonetBackgroundTuning,
    NomandBackgroundTuning,
    LatentBackgroundTuning,
    SoraBackgroundTuning,
    UrlBackgroundItem,
    VisualizerBackgroundMode,
    PartitaTuning,
    Theme,
    TiltTuning,
    VisualizerMode,
} from './types';
import {
    DEFAULT_CAPPELLA_TUNING,
    DEFAULT_CADENZA_TUNING,
    DEFAULT_CLASSIC_TUNING,
    DEFAULT_FUME_TUNING,
    DEFAULT_MONET_TUNING,
    DEFAULT_CLADDAGH_TUNING,
    DEFAULT_PENDOLO_TUNING,
    DEFAULT_SONNET_TUNING,
    DEFAULT_TEMPERA_TUNING,
    DEFAULT_LUMIERE_TUNING,
    DEFAULT_DIORAMA_TUNING,
    DEFAULT_MONET_BACKGROUND_TUNING,
    DEFAULT_PARTITA_TUNING,
    DEFAULT_TILT_TUNING,
} from './types';
import { getFoliaLineIndexAtTime } from './adapter';

export interface LyricVizTuningState {
    classic?: Partial<ClassicTuning>;
    cadenza?: Partial<CadenzaTuning>;
    partita?: Partial<PartitaTuning>;
    fume?: Partial<FumeTuning>;
    cappella?: Partial<CappellaTuning>;
    tilt?: Partial<TiltTuning>;
    monet?: Partial<MonetTuning>;
    claddagh?: Partial<CladdaghTuning>;
    pendolo?: Partial<PendoloTuning>;
    sonnet?: Partial<SonnetTuning>;
    tempera?: Partial<TemperaTuning>;
    lumiere?: Partial<LumiereTuning>;
    diorama?: Partial<DioramaTuning>;
}

export interface LyricVizBackgroundState {
    mode?: VisualizerBackgroundMode;
    transparent?: boolean;
    useCoverColorBg?: boolean;
    opacity?: number;
    disableGeometricBackground?: boolean;
    disableVignette?: boolean;
    monetTuning?: Partial<MonetBackgroundTuning>;
    nomandTuning?: Partial<NomandBackgroundTuning>;
    latentTuning?: Partial<LatentBackgroundTuning>;
    soraTuning?: Partial<SoraBackgroundTuning>;
    urlItems?: UrlBackgroundItem[];
    urlSelectedId?: string | null;
}

export interface LyricVizRuntimeState {
    mode: VisualizerMode | 'off';
    lines: Line[];
    theme: Theme;
    visible: boolean;
    paused: boolean;
    lyricsFontScale: number;
    lyricsLetterSpacing: number;
    lyricsLineHeight: number;
    lyricsFontWeight: number;
    visualizerOpacity: number;
    staticMode: boolean;
    coverUrl: string | null;
    songTitle: string | null;
    songArtist: string | null;
    songAlbum: string | null;
    tuning: LyricVizTuningState;
    background: LyricVizBackgroundState;
    target: 'stage' | 'desktop';
}

interface LyricVizRootProps {
    state: LyricVizRuntimeState;
    currentTime: MotionValue<number>;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
}

const LyricVizRoot: React.FC<LyricVizRootProps> = ({
    state,
    currentTime,
    audioPower,
    audioBands,
}) => {
    const [lineIndex, setLineIndex] = useState(-1);

    useEffect(() => {
        let raf = 0;
        const tick = () => {
            const nextTime = currentTime.get();
            const nextIndex = getFoliaLineIndexAtTime(state.lines, nextTime);
            setLineIndex(prev => (prev !== nextIndex ? nextIndex : prev));
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [currentTime, state.lines]);

    const classicTuning = useMemo(() => ({
        ...DEFAULT_CLASSIC_TUNING,
        ...state.tuning.classic,
    }), [state.tuning.classic]);

    const cadenzaTuning = useMemo(() => ({
        ...DEFAULT_CADENZA_TUNING,
        ...state.tuning.cadenza,
    }), [state.tuning.cadenza]);

    const partitaTuning = useMemo(() => ({
        ...DEFAULT_PARTITA_TUNING,
        ...state.tuning.partita,
    }), [state.tuning.partita]);

    const fumeTuning = useMemo(() => ({
        ...DEFAULT_FUME_TUNING,
        ...state.tuning.fume,
    }), [state.tuning.fume]);

    const cappellaTuning = useMemo(() => ({
        ...DEFAULT_CAPPELLA_TUNING,
        ...state.tuning.cappella,
    }), [state.tuning.cappella]);

    const tiltTuning = useMemo(() => ({
        ...DEFAULT_TILT_TUNING,
        ...state.tuning.tilt,
    }), [state.tuning.tilt]);

    const monetTuning = useMemo(() => ({
        ...DEFAULT_MONET_TUNING,
        ...state.tuning.monet,
    }), [state.tuning.monet]);

    const claddaghTuning = useMemo(() => ({ ...DEFAULT_CLADDAGH_TUNING, ...state.tuning.claddagh }), [state.tuning.claddagh]);
    const pendoloTuning = useMemo(() => ({ ...DEFAULT_PENDOLO_TUNING, ...state.tuning.pendolo }), [state.tuning.pendolo]);
    const sonnetTuning = useMemo(() => ({ ...DEFAULT_SONNET_TUNING, ...state.tuning.sonnet }), [state.tuning.sonnet]);
    const temperaTuning = useMemo(() => ({ ...DEFAULT_TEMPERA_TUNING, ...state.tuning.tempera }), [state.tuning.tempera]);
    const lumiereTuning = useMemo(() => ({ ...DEFAULT_LUMIERE_TUNING, ...state.tuning.lumiere }), [state.tuning.lumiere]);
    const dioramaTuning = useMemo(() => ({ ...DEFAULT_DIORAMA_TUNING, ...state.tuning.diorama,
        geometryVisibility: { ...DEFAULT_DIORAMA_TUNING.geometryVisibility, ...state.tuning.diorama?.geometryVisibility },
    }), [state.tuning.diorama]);

    if (!state.visible || state.mode === 'off') {
        return null;
    }

    const customBackground = /^#[0-9a-f]{6}$/i.test(state.theme.backgroundColor)
        ? state.theme.backgroundColor.slice(1) : '09090b';
    const backgroundLuminance = [0, 2, 4]
        .map(offset => parseInt(customBackground.slice(offset, offset + 2), 16) / 255)
        .map(channel => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4))
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const shellProps = {
        useCoverColorBg: state.background.useCoverColorBg ?? false,
        staticMode: state.staticMode,
        backgroundOpacity: state.background.opacity ?? 0.75,
        visualizerOpacity: state.mode === 'monet'
            ? Math.min(state.visualizerOpacity, 0.88)
            : state.visualizerOpacity,
        transparentBackground: state.background.transparent ?? false,
        disableGeometricBackground: state.background.disableGeometricBackground ?? false,
        disableVignette: state.background.disableVignette ?? false,
        isDaylight: state.theme.name === 'Daylight Default' || (state.theme.name === 'Folia Custom' && backgroundLuminance > 0.5),
        hideTranslationSubtitle: state.target === 'stage',
        visualizerBackgroundMode: state.background.mode ?? (state.mode === 'monet' ? 'monet' : 'common'),
        monetBackgroundTuning: { ...DEFAULT_MONET_BACKGROUND_TUNING, ...state.background.monetTuning },
        nomandBackgroundTuning: state.background.nomandTuning as NomandBackgroundTuning | undefined,
        latentBackgroundTuning: state.background.latentTuning as LatentBackgroundTuning | undefined,
        soraBackgroundTuning: state.background.soraTuning as SoraBackgroundTuning | undefined,
        urlBackgroundList: state.background.urlItems,
        urlBackgroundSelectedId: state.background.urlSelectedId,
        lyricsFontScale: state.lyricsFontScale,
        lyricsLetterSpacing: state.lyricsLetterSpacing,
        lyricsLineHeight: state.lyricsLineHeight,
        lyricsFontWeight: state.lyricsFontWeight,
    };

    return (
        <div className="mineradio-lyric-viz-root" data-target={state.target} data-mode={state.mode} style={{ backgroundColor: state.background.transparent ? 'transparent' : state.theme.backgroundColor }}>
            <VisualizerRenderer
                mode={state.mode}
                currentTime={currentTime}
                currentLineIndex={lineIndex}
                lines={state.lines}
                theme={state.theme}
                audioPower={audioPower}
                audioBands={audioBands}
                showText
                songTitle={state.songTitle}
                songArtist={state.songArtist}
                songAlbum={state.songAlbum}
                coverUrl={state.coverUrl}
                {...shellProps}
                lyricsFontScale={state.lyricsFontScale}
                paused={state.paused}
                isPreviewMode={false}
                classicTuning={classicTuning}
                cadenzaTuning={cadenzaTuning}
                partitaTuning={partitaTuning}
                fumeTuning={fumeTuning}
                cappellaTuning={cappellaTuning}
                tiltTuning={tiltTuning}
                monetTuning={monetTuning}
                claddaghTuning={claddaghTuning}
                pendoloTuning={pendoloTuning}
                sonnetTuning={sonnetTuning}
                temperaTuning={temperaTuning}
                lumiereTuning={lumiereTuning}
                dioramaTuning={dioramaTuning}
                seed={state.songTitle || 'mineradio'}
            />
        </div>
    );
};

export default LyricVizRoot;
