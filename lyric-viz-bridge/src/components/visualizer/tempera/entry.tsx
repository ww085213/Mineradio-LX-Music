import { defineVisualizer } from '../definition';
import VisualizerTempera from './VisualizerTempera';

export default defineVisualizer({
    mode: 'tempera', order: 20, labelKey: 'ui.visualizerTempera',
    labelFallback: '凝彩', previewSeed: 'tempera', previewStartOffset: 0,
    tuningKind: 'none', render: props => <VisualizerTempera {...props} />,
});
