import React, { memo, useEffect, useMemo, useState } from 'react';
import { Theme } from '../../types';

interface FluidBackgroundProps {
    coverUrl?: string | null;
    theme: Theme;
}

const IOS_SOFT_FOCUS_SAMPLE_SIZE = 24;
const IOS_SOFT_FOCUS_OUTPUT_SIZE = 96;

const detectIOSSafari = () => {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent;
    const isAppleMobile = /iPad|iPhone|iPod/i.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isWebKit = /WebKit/i.test(ua);
    const isAltIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|GSA/i.test(ua);

    return isAppleMobile && isWebKit && !isAltIOSBrowser;
};

const buildSoftFocusCover = (coverUrl: string): Promise<string | null> => new Promise((resolve) => {
    if (typeof document === 'undefined') {
        resolve(null);
        return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
        try {
            const sourceCanvas = document.createElement('canvas');
            const outputCanvas = document.createElement('canvas');
            sourceCanvas.width = IOS_SOFT_FOCUS_SAMPLE_SIZE;
            sourceCanvas.height = IOS_SOFT_FOCUS_SAMPLE_SIZE;
            outputCanvas.width = IOS_SOFT_FOCUS_OUTPUT_SIZE;
            outputCanvas.height = IOS_SOFT_FOCUS_OUTPUT_SIZE;

            const sourceCtx = sourceCanvas.getContext('2d');
            const outputCtx = outputCanvas.getContext('2d');
            if (!sourceCtx || !outputCtx) {
                resolve(null);
                return;
            }

            const naturalWidth = img.naturalWidth || img.width;
            const naturalHeight = img.naturalHeight || img.height;
            const squareSize = Math.min(naturalWidth, naturalHeight);
            const sx = Math.max(0, (naturalWidth - squareSize) / 2);
            const sy = Math.max(0, (naturalHeight - squareSize) / 2);

            sourceCtx.imageSmoothingEnabled = true;
            sourceCtx.imageSmoothingQuality = 'high';
            sourceCtx.drawImage(
                img,
                sx,
                sy,
                squareSize,
                squareSize,
                0,
                0,
                IOS_SOFT_FOCUS_SAMPLE_SIZE,
                IOS_SOFT_FOCUS_SAMPLE_SIZE
            );

            outputCtx.imageSmoothingEnabled = true;
            outputCtx.imageSmoothingQuality = 'high';
            outputCtx.globalAlpha = 1;
            outputCtx.drawImage(
                sourceCanvas,
                0,
                0,
                IOS_SOFT_FOCUS_SAMPLE_SIZE,
                IOS_SOFT_FOCUS_SAMPLE_SIZE,
                0,
                0,
                IOS_SOFT_FOCUS_OUTPUT_SIZE,
                IOS_SOFT_FOCUS_OUTPUT_SIZE
            );

            const softPasses = [
                { x: -8, y: -8, size: IOS_SOFT_FOCUS_OUTPUT_SIZE + 16, alpha: 0.22 },
                { x: 6, y: 0, size: IOS_SOFT_FOCUS_OUTPUT_SIZE, alpha: 0.14 },
                { x: 0, y: 6, size: IOS_SOFT_FOCUS_OUTPUT_SIZE, alpha: 0.14 },
            ];

            softPasses.forEach(({ x, y, size, alpha }) => {
                outputCtx.globalAlpha = alpha;
                outputCtx.drawImage(
                    sourceCanvas,
                    0,
                    0,
                    IOS_SOFT_FOCUS_SAMPLE_SIZE,
                    IOS_SOFT_FOCUS_SAMPLE_SIZE,
                    x,
                    y,
                    size,
                    size
                );
            });

            outputCtx.globalAlpha = 1;
            resolve(outputCanvas.toDataURL('image/jpeg', 0.72));
        } catch (error) {
            console.warn('[FluidBackground] Failed to build soft focus cover', error);
            resolve(null);
        }
    };

    img.onerror = () => resolve(null);
    img.src = coverUrl;
});

const FluidBackground: React.FC<FluidBackgroundProps> = memo(({ coverUrl, theme }) => {
    const isIOSSafari = useMemo(detectIOSSafari, []);
    const [softFocusCoverUrl, setSoftFocusCoverUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        if (!isIOSSafari || !coverUrl) {
            setSoftFocusCoverUrl(null);
            return () => {
                cancelled = true;
            };
        }

        setSoftFocusCoverUrl(null);

        void buildSoftFocusCover(coverUrl).then((nextUrl) => {
            if (!cancelled) {
                setSoftFocusCoverUrl(nextUrl);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [coverUrl, isIOSSafari]);

    const iosDisplayCoverUrl = isIOSSafari ? (softFocusCoverUrl ?? coverUrl ?? null) : null;
    const isSoftFocusReady = isIOSSafari && Boolean(softFocusCoverUrl);
    const coverLayerStyle = useMemo<React.CSSProperties>(() => {
        if (isIOSSafari) {
            return {
                transform: `scale(${isSoftFocusReady ? 1.28 : 1.2}) translateZ(0)`,
                opacity: isSoftFocusReady ? 0.94 : 0.3,
                willChange: 'transform, opacity',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
            };
        }

        return {
            filter: 'blur(40px)',
            transform: 'scale(1.5) translateZ(0)',
            opacity: 1,
            willChange: 'transform, opacity, filter',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
        };
    }, [isIOSSafari, isSoftFocusReady]);

    return (
        <div
            className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0"
            style={{
                isolation: 'isolate',
                contain: 'paint',
                transform: 'translateZ(0)',
            }}
        >
            {/* Background Image / Fallback */}
            {coverUrl ? (
                <>
                    <img
                        src={iosDisplayCoverUrl ?? coverUrl}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        decoding="async"
                        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-out"
                        style={coverLayerStyle}
                    />

                    {isIOSSafari && (
                        <>
                            {!isSoftFocusReady && (
                                <img
                                    src={coverUrl}
                                    alt=""
                                    aria-hidden="true"
                                    draggable={false}
                                    decoding="async"
                                    className="absolute inset-0 w-full h-full object-cover"
                                    style={{
                                        transform: 'scale(1.36) translateZ(0)',
                                        opacity: 0.12,
                                        willChange: 'transform, opacity',
                                        backfaceVisibility: 'hidden',
                                        WebkitBackfaceVisibility: 'hidden',
                                    }}
                                />
                            )}

                            <div
                                className="absolute inset-0 w-full h-full"
                                style={{
                                    backgroundColor: theme.backgroundColor,
                                    opacity: 0.28,
                                }}
                            />

                            <div
                                className="absolute inset-0 w-full h-full"
                                style={{
                                    background: `radial-gradient(circle at 20% 20%, ${theme.accentColor}55 0%, transparent 42%), radial-gradient(circle at 80% 28%, ${theme.secondaryColor}50 0%, transparent 44%), radial-gradient(circle at 50% 78%, ${theme.primaryColor}28 0%, transparent 52%)`,
                                    opacity: isSoftFocusReady ? 0.52 : 0.7,
                                }}
                            />
                        </>
                    )}
                </>
            ) : (
                <div
                    className="absolute inset-0 w-full h-full transition-colors duration-1000"
                    style={{
                        backgroundColor: theme.backgroundColor,
                        opacity: 0.8
                    }}
                />
            )}

            {/* Overlay Gradient for better text readability and blending */}
            <div
                className="absolute inset-0 w-full h-full"
                style={{
                    background: `linear-gradient(to bottom right, ${theme.primaryColor}, transparent, ${theme.secondaryColor})`,
                    opacity: isIOSSafari ? 0.2 : 0.4,
                    mixBlendMode: isIOSSafari ? 'normal' : 'overlay',
                }}
            />
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison function for React.memo
    if (prevProps.coverUrl !== nextProps.coverUrl) return false;

    const pTheme = prevProps.theme;
    const nTheme = nextProps.theme;

    return (
        pTheme.backgroundColor === nTheme.backgroundColor &&
        pTheme.primaryColor === nTheme.primaryColor &&
        pTheme.secondaryColor === nTheme.secondaryColor
    );
});

export default FluidBackground;
