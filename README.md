# GR Color Engine

The Ricoh GR IIIx colour pipeline, reverse-engineered from 302
in-camera developments of a single RAW file, and the engine behind
[GR Recipe Lab](https://callmeseva.cc/recipelab/). It renders GR recipes
(Image Control, sliders, white balance) on any photo in the browser with
WebGL, reads the recipe an original GR JPEG or DNG was shot with, and makes
recipe links, cards and social images.

How it was built, layer by layer, with accuracy numbers:
**[callmeseva.cc/recipelab/how-it-works](https://callmeseva.cc/recipelab/how-it-works/)**

Free for non-commercial use, with credit. Not affiliated with Ricoh.

## Packages

| Package | What it is |
|---|---|
| [`@callmeseva/gr-color-engine`](packages/engine) | Renderer, recipe decoder, recipe links, recipe text, cards. Framework-free. |
| [`@callmeseva/gr-color-react`](packages/react) | `<RecipePreview>` and `<RecipeSliders>` for React. |
| [`@callmeseva/gr-color-mcp`](packages/mcp) | MCP server so AI coding assistants can build the engine into a project. |

## Quick start

```sh
npm i @callmeseva/gr-color-engine
```

```ts
import { RecipeRenderer, createDefaultParams, decodeRecipeFromFile, loadCameraImage } from '@callmeseva/gr-color-engine';

const renderer = new RecipeRenderer(document.querySelector('canvas')!);
await renderer.setImage(await loadCameraImage(file));
// An original GR photo already has a look baked in: decode it so the engine undoes it first.
const shot = await decodeRecipeFromFile(file);
const baseline = shot.status === 'decoded' ? shot.result.params : undefined;
renderer.render({ ...createDefaultParams('positive-film'), saturation: 2, wbShiftAB: 4 }, { baseline });
```

React:

```tsx
import { RecipePreview, RecipeSliders } from '@callmeseva/gr-color-react';

<RecipePreview image={photoUrl} params={params} />
<RecipeSliders params={params} onChange={setParams} />
```

## For AI coding assistants (MCP)

```sh
claude mcp add gr-color -- npx -y @callmeseva/gr-color-mcp
```

Tools: `describe_stack`, `list_image_controls`, `decode_recipe` (reads a
local GR file), `format_recipe`, `parse_recipe_text`, `encode_link`,
`decode_link`, `integration_guide`. It runs on your machine; files are
never sent anywhere.

## The engine in five layers

1. **White balance**: WB modes and A/B, G/M shifts, as measured operators (3×3 matrix + per-channel curves).
2. **Image Control**: one measured operator per colour look.
3. **Saturation & Hue**: a measured saturation operator for every step; hue is a parametric rotation with per-look correction.
4. **Tone**: High/Low Key, Contrast and its highlight/shadow halves, as measured curves.
5. **Finish**: clarity, sharpness, shading, grain, mono filter and toning (parametric, spatial).

Tested in the real renderer against 42 in-camera developments; results in
[`calibration/engine-check`](calibration/engine-check).

## Calibration data

[`calibration/`](calibration) holds the fitted operators (`ops/ops.json`),
validation results and the fitting scripts. The scripts need the
calibration photos, which are **not part of this release**. If you need
them for research, ask in the
[GR Recipe Lab Telegram group](https://t.me/+L0fPKKvFH0UyNDBh).

## Licence

- Code: [PolyForm Noncommercial 1.0.0](LICENSE). Free for any
  non-commercial purpose; keep the copyright notice.
- Calibration data and documentation: [CC BY-NC 4.0](LICENSE-DATA).

Please credit **"GR Color Engine by callmeSeva"** with a link to
https://callmeseva.cc/recipelab. For commercial use, get in touch through
the Telegram group.

Copyright (c) 2026 Fabio Seva (callmeSeva). Ricoh and GR are trademarks of
Ricoh Imaging Company; this project is independent and unofficial.
