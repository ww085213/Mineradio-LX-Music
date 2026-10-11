// Copyright (c) 2026 chthollyphile. Local bridge entry adapter.
import { defineVisualizer } from '../definition';
import VisualizerLumiere from './VisualizerLumiere';

export default defineVisualizer({
    mode: 'lumiere', order: 25, labelKey: 'ui.visualizerLumiere',
    labelFallback: '绘光', previewSeed: 'lumiere', previewStartOffset: 0,
    tuningKind: 'none', render: props => <VisualizerLumiere {...props} />,
});
