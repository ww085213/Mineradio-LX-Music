import { defineVisualizer } from '../definition';
import VisualizerPendolo from './VisualizerPendolo';

export default defineVisualizer({
    mode: 'pendolo', order: 100, labelKey: 'ui.visualizerPendolo',
    labelFallback: 'Pendolo', previewSeed: 'pendolo', previewStartOffset: 0,
    tuningKind: 'none', render: props => <VisualizerPendolo {...props} />,
});
