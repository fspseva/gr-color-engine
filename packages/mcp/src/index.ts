#!/usr/bin/env node
/**
 * GR Color Engine MCP server (stdio). Gives AI coding assistants what they
 * need to build the engine into a project: the layer stack, every Image
 * Control and slider, recipe decoding from local files, recipe text and
 * links, and integration code. Runs locally; files are read on this machine
 * and never sent anywhere.
 */
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  IMAGE_CONTROLS,
  RANGES,
  clampParams,
  createDefaultParams,
  decodeRecipeFromFile,
  decodeRecipeHash,
  encodeRecipeHash,
  parseRecipeText,
  redditText,
  xText,
  orderedRows,
  type RecipeParams,
} from '@fspseva/gr-color-engine';

const SITE = 'https://callmeseva.cc/recipelab/';

const STACK = [
  { layer: 1, name: 'White balance', settings: ['wbMode', 'wbShiftAB', 'wbShiftGM'], kind: 'measured operators (3x3 matrix + per-channel curves)', note: 'Mode first, then G/M, then A/B. Shift operators measured at 7 and 14 steps per side, interpolated between.' },
  { layer: 2, name: 'Image Control', settings: ['control'], kind: 'one measured operator per colour look', note: 'Standard is identity; HDR Tone and the monochrome looks are parametric.' },
  { layer: 3, name: 'Saturation & Hue', settings: ['saturation', 'hue'], kind: 'saturation: measured operator per step; hue: parametric rotation with per-look correction', note: 'Saturation is applied after the look.' },
  { layer: 4, name: 'Tone', settings: ['highLowKey', 'contrast', 'contrastHighlight', 'contrastShadow', 'highlightCorrection', 'shadowCorrection'], kind: 'measured per-channel curves', note: 'Key before Contrast. Corrections compress the ends before the curves.' },
  { layer: 5, name: 'Finish', settings: ['clarity', 'sharpness', 'shading', 'grain', 'filterOn', 'filterR', 'filterG', 'filterB', 'toning', 'namedToning'], kind: 'parametric (spatial effects, mono)', note: 'Depends on neighbouring pixels or position, so not a per-pixel operator.' },
];

const paramsSchema = z
  .record(z.unknown())
  .describe('RecipeParams (partial is fine): control, saturation, hue, highLowKey, contrast, contrastHighlight, contrastShadow, sharpness, clarity, shading, grain, wbMode, wbShiftAB, wbShiftGM, highlightCorrection, shadowCorrection, filterOn/R/G/B, toning, namedToning');

function toParams(input: Record<string, unknown>): RecipeParams {
  const control = typeof input.control === 'string' ? input.control : 'standard';
  const base = createDefaultParams(control as RecipeParams['control']);
  return clampParams({ ...base, ...(input as Partial<RecipeParams>) });
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

const server = new McpServer({ name: 'gr-color-engine', version: '1.0.0' });

server.tool('describe_stack', 'The engine as five layers in camera order: which settings each layer covers and how it is modelled.', async () =>
  json({ layers: STACK, docs: `${SITE}how-it-works/` }),
);

server.tool('list_image_controls', 'Every Ricoh GR Image Control with the sliders it exposes, plus the numeric ranges of every slider.', async () =>
  json({
    controls: IMAGE_CONTROLS.map((c) => ({ id: c.id, label: c.label, about: c.blurb, sliders: c.sliders, mono: c.base.mono })),
    ranges: RANGES,
    defaults: createDefaultParams('standard'),
  }),
);

server.tool(
  'decode_recipe',
  'Read the recipe (Image Control, sliders, WB) an original Ricoh GR JPEG or DNG was shot with, from a file on this machine.',
  { path: z.string().describe('Absolute path to a GR JPEG or DNG') },
  async ({ path }) => {
    const buf = await readFile(path);
    const out = await decodeRecipeFromFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    return json(out);
  },
);

server.tool(
  'format_recipe',
  'Turn settings into text in the usual Ricoh posting order: "reddit" (one setting per line), "x" (one line under 280 characters) or "rows" (label/value pairs).',
  {
    params: paramsSchema,
    style: z.enum(['reddit', 'x', 'rows']).default('reddit'),
    name: z.string().default('Custom recipe'),
    credit: z.string().optional(),
  },
  async ({ params, style, name, credit }) => {
    const p = toParams(params);
    const url = SITE + encodeRecipeHash({ params: p, name, credit });
    if (style === 'rows') return json(orderedRows(p, {}));
    return text(style === 'x' ? xText(p, { name, credit, url }) : redditText(p, { name, credit, url }));
  },
);

server.tool(
  'parse_recipe_text',
  'Read a recipe pasted as text ("Image Control: Positive Film", "Saturation: +2", "WB Shift: A3 G1"…) back into settings. Lines that could not be read are listed.',
  { text: z.string() },
  async ({ text: t }) => json(parseRecipeText(t)),
);

server.tool(
  'encode_link',
  'Make a GR Recipe Lab link that opens the recipe applied, with the editor filled in. Settings live in the URL fragment; nothing is stored.',
  {
    params: paramsSchema,
    name: z.string().optional(),
    credit: z.string().optional(),
    url: z.string().optional().describe("Author's https link"),
    origin: z.string().default(SITE).describe('Site to link to, if you host the engine yourself'),
  },
  async ({ params, name, credit, url, origin }) =>
    text(origin + encodeRecipeHash({ params: toParams(params), name, credit, url })),
);

server.tool('decode_link', 'Read the settings, name and credit out of a recipe link (#r=…).', { link: z.string() }, async ({ link }) => {
  const hash = link.includes('#') ? link.slice(link.indexOf('#')) : link;
  return json(decodeRecipeHash(hash) ?? { error: 'Not a recipe link' });
});

const GUIDE: Record<string, string> = {
  react: `npm i @fspseva/gr-color-engine @fspseva/gr-color-react

import { useState } from 'react';
import { createDefaultParams } from '@fspseva/gr-color-engine';
import { RecipePreview, RecipeSliders } from '@fspseva/gr-color-react';

export function Editor({ photoUrl }: { photoUrl: string }) {
  const [params, setParams] = useState(createDefaultParams('positive-film'));
  return (
    <>
      <RecipePreview image={photoUrl} params={params} />
      <RecipeSliders params={params} onChange={setParams} />
    </>
  );
}

// Original GR photo? Decode its recipe and pass it as \`baseline\` so the
// engine undoes the look already baked in before applying a new one:
//   const out = await decodeRecipeFromFile(file);
//   <RecipePreview image={bitmap} params={params} baseline={out.status === 'decoded' ? out.result.params : undefined} />`,
  vanilla: `npm i @fspseva/gr-color-engine

import { RecipeRenderer, createDefaultParams, decodeRecipeFromFile, loadCameraImage } from '@fspseva/gr-color-engine';

const canvas = document.querySelector('canvas');
const renderer = new RecipeRenderer(canvas);          // WebGL; throws WebGLUnavailableError without it
const image = await loadCameraImage(file);            // JPEG, or the embedded preview of a DNG
await renderer.setImage(image);
const shot = await decodeRecipeFromFile(file);        // the recipe the photo was shot with
const baseline = shot.status === 'decoded' ? shot.result.params : undefined;
renderer.render({ ...createDefaultParams('negative-film'), saturation: 2, wbShiftAB: 4 }, { baseline });`,
  cards: `import { buildCardData, drawRecipeCard, drawSocial } from '@fspseva/gr-color-engine';

// Recipe card (1000×1400, or 1000×1778 with a photo):
const card = drawRecipeCard(buildCardData(params, { name: 'My recipe', credit: '@me' }), renderedCanvas);
// Before/after for social: 'post' 1080×1350, 'story' 1080×1920 (safe areas), 'x' 1600×900:
const post = drawSocial('post', { params, name: 'My recipe', credit: '@me', before: originalBitmap, after: renderedCanvas });`,
};

server.tool(
  'integration_guide',
  'Step-by-step code for adding the engine to a project: "react" (preview + sliders), "vanilla" (plain WebGL canvas) or "cards" (recipe cards and social images).',
  { target: z.enum(['react', 'vanilla', 'cards']).default('react') },
  async ({ target }) =>
    text(`${GUIDE[target]}\n\nLicence: PolyForm Noncommercial 1.0.0. Free for non-commercial use; keep the copyright notice and credit "GR Color Engine by callmeSeva".`),
);

await server.connect(new StdioServerTransport());
