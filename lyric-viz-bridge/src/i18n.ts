import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
    'zh-CN': {
        translation: {
            ui: {
                waitingForMusic: '等待音乐',
                visualizerClassic: '流光',
                visualizerCadenza: '心象',
                visualizerPartita: '云阶',
                visualizerFume: '浮名',
                visualizerCappella: '群唱',
                visualizerTilt: '倾诉',
                visualizerMonet: '莫奈',
                visualizerCladdagh: 'Claddagh',
                visualizerDiorama: '镜台',
                visualizerLumiere: '绘光',
                visualizerPendolo: 'Pendolo',
                visualizerSonnet: '商籁',
                visualizerStill: 'Still',
                visualizerTempera: '凝彩',
            },
            options: {
                urlBackgroundSettings: 'URL 背景',
                urlBackgroundSettingsDesc: '将网页显示为播放页背景。',
                urlBackgroundNotePlaceholder: '备注',
                urlBackgroundAdd: '添加 URL',
                urlBackgroundEmpty: '暂无 URL',
            },
        },
    },
};

if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
        resources,
        lng: 'zh-CN',
        fallbackLng: 'zh-CN',
        interpolation: { escapeValue: false },
    });
}

export default i18n;
