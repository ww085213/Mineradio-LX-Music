import type { Line, Word } from './types';
import { migrateLyricDataRenderHints, type RenderHintLineLike } from './utils/lyrics/renderHints';

export interface MineradioLyricWord {
    text: string;
    t: number;
    d?: number;
    c0?: number;
    c1?: number;
}

export interface MineradioLyricLine {
    t: number;
    text: string;
    duration?: number;
    words?: MineradioLyricWord[];
    charCount?: number;
    fallback?: boolean;
    translation?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildTimedWords = (text: string, startTime: number, endTime: number): Word[] => {
    const duration = Math.max(endTime - startTime, 0.1);
    const rawTokens = text.split(/\s+/).filter(token => token);
    const tokens: Array<{ text: string; weight: number }> = [];
    let totalWeight = 0;

    for (const token of rawTokens) {
        if (/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(token)) {
            token.split('').forEach(char => {
                const isPunctuation = /[，。！？、：；"'）]/.test(char);
                const weight = isPunctuation ? 0 : 1;
                tokens.push({ text: char, weight });
                totalWeight += weight;
            });
        } else {
            const weight = 1 + (token.length * 0.15);
            tokens.push({ text: token, weight });
            totalWeight += weight;
        }
    }

    if (totalWeight === 0) {
        totalWeight = 1;
    }

    const activeDuration = duration * 0.9;
    const timePerWeight = activeDuration / totalWeight;
    let currentWordStart = startTime;
    const words: Word[] = [];

    tokens.forEach(token => {
        const wordDuration = token.weight * timePerWeight;
        const finalDuration = Math.max(wordDuration, 0.05);

        words.push({
            text: token.text,
            startTime: currentWordStart,
            endTime: currentWordStart + finalDuration,
        });

        if (token.weight > 0) {
            currentWordStart += wordDuration;
        } else {
            currentWordStart += 0.05;
        }
    });

    if (words.length > 0) {
        words[words.length - 1].endTime = Math.max(words[words.length - 1].endTime, endTime);
    }

    return words;
};

const splitPseudoWords = (text: string, startTime: number, endTime: number): Word[] => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return [];
    return buildTimedWords(trimmed, startTime, endTime);
};

export const mineradioLineToFoliaLine = (
    line: MineradioLyricLine,
    nextLine: MineradioLyricLine | null | undefined,
): Line => {
    const startTime = Number(line.t) || 0;
    const nextStart = nextLine && nextLine.t > startTime ? nextLine.t : null;
    const duration = clamp(
        Number(line.duration) || (nextStart != null ? nextStart - startTime : 4.8),
        0.45,
        12,
    );
    // Karaoke/YRC supplies an actual line duration. Preserve its silent gap before the
    // next line; stretching every line to the next timestamp changes Folia's shot timing.
    const endTime = Math.min(nextStart ?? Infinity, startTime + duration);
    const fullText = String(line.text || '').replace(/\s+/g, ' ').trim();

    let words: Word[] = [];
    if (Array.isArray(line.words) && line.words.length) {
        words = line.words
            .filter(w => w && String(w.text || '').trim())
            .map(w => ({
                text: String(w.text || ''),
                startTime: Number(w.t) || startTime,
                endTime: Math.max(
                    Number(w.t) + Math.max(0.06, Number(w.d) || 0.24),
                    Number(w.t) + 0.06,
                ),
            }));
    }

    if (!words.length && fullText) {
        words = splitPseudoWords(fullText, startTime, endTime);
    }

    return {
        words,
        startTime,
        endTime,
        fullText,
        translation: line.translation,
    };
};

export const mineradioLinesToFoliaLines = (lines: MineradioLyricLine[]): Line[] => {
    const source = Array.isArray(lines) ? lines.filter(l => l && String(l.text || '').trim()) : [];
    const foliaLines = source.map((line, index) => mineradioLineToFoliaLine(line, source[index + 1]));
    const migrated = migrateLyricDataRenderHints({ lines: foliaLines as RenderHintLineLike[] });
    return migrated.value.lines as Line[];
};

export const getFoliaLineIndexAtTime = (lines: Line[], timeSec: number): number => {
    if (!lines.length) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startTime <= timeSec + 0.05) idx = i;
        else break;
    }
    return idx;
};
