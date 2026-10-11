import { defineVisualizer } from '../definition';
import VisualizerSonnet from './VisualizerSonnet';

export default defineVisualizer({
    mode: 'sonnet', order: 10, labelKey: 'ui.visualizerSonnet',
    labelFallback: '商籁', previewSeed: 'sonnet', previewStartOffset: 0,
    tuningKind: 'none', render: props => <VisualizerSonnet {...props} />,
});
