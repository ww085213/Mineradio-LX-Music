import { defineVisualizer } from '../definition';
import VisualizerDiorama from './VisualizerDiorama';

export default defineVisualizer({
    mode: 'diorama', order: 120, labelKey: 'ui.visualizerDiorama',
    labelFallback: '镜台', previewSeed: 'diorama', previewStartOffset: 0,
    tuningKind: 'none', render: props => <VisualizerDiorama {...props} />,
});
