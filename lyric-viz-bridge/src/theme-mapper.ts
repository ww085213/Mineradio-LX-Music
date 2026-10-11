import type { Theme } from './types';

export interface MineradioLyricThemeInput {
    primary?: string;
    secondary?: string;
    highlight?: string;
    glow?: string;
    backgroundColor?: string;
    fontFamily?: string;
    animationIntensity?: 'calm' | 'normal' | 'chaotic';
}

const DEFAULT_THEME: Theme = {
    name: 'Mineradio',
    backgroundColor: '#040608',
    primaryColor: '#f6fdff',
    accentColor: '#a8f6ff',
    secondaryColor: '#9cffdf',
    fontStyle: 'sans',
    animationIntensity: 'normal',
    wordColors: [],
    lyricsIcons: [],
};

export const mapMineradioTheme = (input: MineradioLyricThemeInput = {}): Theme => ({
    ...DEFAULT_THEME,
    backgroundColor: input.backgroundColor || DEFAULT_THEME.backgroundColor,
    primaryColor: input.primary || DEFAULT_THEME.primaryColor,
    accentColor: input.highlight || input.glow || DEFAULT_THEME.accentColor,
    secondaryColor: input.secondary || input.glow || DEFAULT_THEME.secondaryColor,
    fontFamily: input.fontFamily || undefined,
    animationIntensity: input.animationIntensity || 'normal',
});
