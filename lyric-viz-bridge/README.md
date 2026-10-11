# Mineradio lyric visualizer bridge (Windows/iOS 1.7.0)

`src/` started with 73 authored source files recovered from the committed
`lyric-viz-bridge.js.map`. Seven additional Folia visualizer modes and their
shared dependencies were then imported from the pinned upstream revision.

`upstream-v0.7.16/` preserves the seven additional Folia visualizer mode directories
from [Folia v0.7.16](https://github.com/chthollyphile/folia-major/tree/v0.7.16/src/components/visualizer)
at commit `c69afdcba85fe6ca1f5c9f5cb83be3e83adfcd67`. The local bridge
offers all 14 modes. Build from this directory with `npm ci --ignore-scripts`
followed by `npm run build`. Copy `dist-local/lyric-viz-bridge.js`,
`dist-local/lyric-viz-bridge.css`, and `dist-local/lyric-viz-bridge.js.map` to
`../public/vendor/lyric-viz/` before packaging Mineradio. The dependency
lockfile, renderer sources and referenced image assets are included.
The bridge also includes Folia's background renderer sources. Mineradio's
own settings controls expose the ported mode and background parameters and save
them through its lyric-layout settings. It does not embed Folia's original
settings-panel component or persistent image asset store.

Folia code is AGPL-3.0; see `../licenses/Folia-AGPL-3.0.txt` and the project
notice. Preserve these licenses and source notices when redistributing.
The `v1.7.0` source tag contains the sources corresponding to its release bundle.
