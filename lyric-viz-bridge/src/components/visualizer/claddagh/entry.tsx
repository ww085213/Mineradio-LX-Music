import { defineVisualizer } from '../definition';
import VisualizerCladdagh from './VisualizerCladdagh';

// Local bridge adapter; upstream source is retained in upstream-v0.7.16/.
export default defineVisualizer({
    mode: 'claddagh', order: 80, labelKey: 'ui.visualizerCladdagh',
    labelFallback: 'Claddagh', previewSeed: 'claddagh', previewStartOffset: 0,
    tuningKind: 'none', render: props => <VisualizerCladdagh {...props} />,
});
