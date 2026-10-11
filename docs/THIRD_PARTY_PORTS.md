# Third-party ports

## Folia lyric visualizer

- Upstream: [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)
- Upstream license: GNU AGPL v3; preserve the original copyright notices.
- Windows release modes: `classic`, `cadenza`, `partita`, `fume`, `cappella`,
  `tilt`, `monet`, `claddagh`, `diorama`, `lumiere`, `pendolo`, `sonnet`, `still`,
  `tempera`.
- Mineradio-specific changes: `lyric-viz-bridge/src/adapter.ts`, `bridge.tsx`,
  `LyricVizRoot.tsx`, and `theme-mapper.ts` translate Mineradio playback state,
  synchronized lyrics, palette, and audio bands into Folia renderer inputs.

The original bridge sources were recovered from the committed
`public/vendor/lyric-viz/lyric-viz-bridge.js.map` by running
`node build/extract-lyric-viz-source.js`. The additional mode sources and
shared dependencies come from pinned Folia v0.7.16 revision
`c69afdcba85fe6ca1f5c9f5cb83be3e83adfcd67`. The local build procedure is
documented in `lyric-viz-bridge/README.md`. The complete bridge sources,
build configuration, dependency lockfile, and referenced image assets are
distributed in the `v1.7.0` source tag. The source map was checked against
the 252 authored text sources used by the release bundle. This integration
does not include the original Folia settings-panel component or persistent
asset store. Mineradio exposes its own local controls for the ported mode
parameters, theme colors, and the original Folia background renderer modules
(`common`, `monet`, `nomand`, `latent`, `url`, and `sora`). The URL mode accepts
an HTTPS page, not a local image upload. Settings are saved through Mineradio's
lyric-layout persistence. Visual parity with every Folia preset is not claimed.

GNU GPL v3 and AGPL v3 explicitly allow combining covered code; Folia's AGPL
requirements still apply to the combined work. See the included Folia license
copy at `licenses/Folia-AGPL-3.0.txt` and the upstream source repository.

## Mineradio-LX-Music desktop/home reference

- Upstream: `ww085213/Mineradio-LX-Music`
- Initial reference revision: `82826df814c32853d99697c0ee60f749a2fcad79`
- Homepage refresh revision: `812e2dc2e18bbc263e61dbd0206cb765e003d6e9`
- License: GNU GPL v3 (`GPL-3.0-only`)
- Port dates: 2026-07-18 (initial), 2026-07-19 (homepage refresh)

Mineradio's full desktop mode adapts the upstream idea of moving the existing
Electron main-window HWND between the Windows WorkerW desktop layer and an
interactive top-level window. The native attach/detach code in this project was
rewritten around the optimized edition's fail-closed WorkerW discovery, DPI
conversion, structured acknowledgements, serialized lifecycle, and cleanup
requirements.

The home dashboard adapts the upstream information hierarchy (continue,
library, daily recommendations, recent playback, today's listening, next up,
discovery, and radio entry points). Its data adapters use this project's current
multi-provider discovery, playlist, search, playback queue, and listen-history
state. Upstream LX-only server routes and the legacy standalone wallpaper
overlay were not copied.

The 2026-07-19 refresh additionally adapts the three-song "For You" strip,
stable cover-image swaps, in-place quick-card updates, daily-review hover
feedback, and compact-height scrolling/settings behavior. These features remain
implemented against Mineradio's existing provider, weather-radio, local-library,
queue, and playback modules rather than the upstream LX/local-only data model.

The combined application remains distributed under the repository's GNU GPL v3
license. Preserve this notice and the corresponding source when redistributing
modified builds.
