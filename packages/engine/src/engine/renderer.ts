import type { RecipeParams } from '../recipes/types';
import { buildUniforms, type EngineUniforms } from './uniforms';
import { CURVE_SAMPLES, MAX_MATS, packChain } from './ops';
import { FRAGMENT_SRC, VERTEX_SRC } from './shaders';

const MAX_PREVIEW_DIM = 1600;

export class WebGLUnavailableError extends Error {
  constructor() {
    super('WebGL is not available in this browser.');
  }
}

interface TextureSet {
  image: WebGLTexture;
  blurSmall: WebGLTexture;
  blurLarge: WebGLTexture;
  width: number;
  height: number;
}

/**
 * Renders a source image through the recipe pipeline into a canvas.
 * Usage: create with a target canvas, `setImage(bitmap)` once per photo,
 * then `render(params, { bypass })` on every slider change.
 */
export class RecipeRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private textures: TextureSet | null = null;
  private uniformLocs = new Map<string, WebGLUniformLocation | null>();
  private curveTex: WebGLTexture | null = null;
  private contextLost = false;
  private onLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    this.onContextLost?.();
  };
  /** Set by the owner: called once when the WebGL context dies (backgrounded
   *  tab, device sleep). The owner should rebuild the renderer — after a loss
   *  every draw call is a silent no-op and the canvas keeps its stale frame. */
  onContextLost: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (!gl) throw new WebGLUnavailableError();
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost);
    this.program = this.buildProgram();

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  }

  private buildProgram(): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SRC));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);
    return program;
  }

  private loc(name: string): WebGLUniformLocation | null {
    if (!this.uniformLocs.has(name)) {
      this.uniformLocs.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.uniformLocs.get(name)!;
  }

  private uploadTexture(source: TexImageSource): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return tex;
  }

  /**
   * Prepare a photo for rendering: downscale to preview size and produce the
   * two blurred companions used for sharpness (small radius) and
   * clarity/HDR local contrast (large radius).
   */
  async setImage(source: ImageBitmap | HTMLImageElement): Promise<void> {
    const srcW = source.width;
    const srcH = source.height;
    const glMax = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    const maxDim = Math.min(MAX_PREVIEW_DIM, glMax);
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));

    const draw = (blurPx: number): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
      ctx.drawImage(source, 0, 0, w, h);
      return c;
    };

    const base = draw(0);
    const small = draw(1.2);
    const large = draw(Math.max(6, Math.round(Math.max(w, h) * 0.02)));

    this.disposeTextures();
    this.textures = {
      image: this.uploadTexture(base),
      blurSmall: this.uploadTexture(small),
      blurLarge: this.uploadTexture(large),
      width: w,
      height: h,
    };
    this.canvas.width = w;
    this.canvas.height = h;
  }

  get hasImage(): boolean {
    return this.textures !== null;
  }

  /** True once the WebGL context has died — renders would silently no-op. */
  get isContextLost(): boolean {
    return this.contextLost || this.gl.isContextLost();
  }

  render(params: RecipeParams, opts: { bypass?: boolean; baseline?: RecipeParams } = {}): void {
    if (this.isContextLost) {
      // Never pretend: a draw on a lost context leaves the previous frame in
      // the canvas, which downloads would then ship under fresh metadata.
      throw new Error('WebGL context lost');
    }
    const t = this.textures;
    if (!t) return;
    const gl = this.gl;
    const u = buildUniforms(params, opts.baseline);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);

    const bind = (unit: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.loc(name), unit);
    };
    bind(0, t.image, 'uImage');
    bind(1, t.blurSmall, 'uBlurSmall');
    bind(2, t.blurLarge, 'uBlurLarge');

    const maxDim = Math.max(t.width, t.height);
    gl.uniform2f(this.loc('uAspect'), t.width / maxDim, t.height / maxDim);

    this.uploadChain(u.chain, 3);
    gl.uniform1f(this.loc('uHlCompress'), u.hlCompress);
    gl.uniform1f(this.loc('uShLift'), u.shLift);
    gl.uniform1f(this.loc('uBlackLift'), u.blackLift);
    gl.uniform1f(this.loc('uWhitePoint'), u.whitePoint);
    gl.uniform1f(this.loc('uGamma'), u.gamma);
    gl.uniform1f(this.loc('uSCurve'), u.sCurve);
    gl.uniform1f(this.loc('uSatMul'), u.satMul);
    gl.uniform1f(this.loc('uHueDeg'), u.hueDeg);
    gl.uniform3fv(this.loc('uShadowTint'), u.shadowTint);
    gl.uniform3fv(this.loc('uHighlightTint'), u.highlightTint);
    gl.uniform1f(this.loc('uClarityAmt'), u.clarityAmt);
    gl.uniform1f(this.loc('uLocalContrastAmt'), u.localContrastAmt);
    gl.uniform1f(this.loc('uSharpAmt'), u.sharpAmt);
    gl.uniform1f(this.loc('uVignetteAmt'), u.vignetteAmt);
    gl.uniform1f(this.loc('uGrainAmt'), u.grainAmt);
    gl.uniform1f(this.loc('uMono'), u.mono ? 1 : 0);
    gl.uniform3fv(this.loc('uMonoWeights'), u.monoWeights);
    gl.uniform3fv(this.loc('uToningTint'), u.toningTint);
    gl.uniform1fv(this.loc('uHueCorDh'), u.hueCorDh);
    gl.uniform1fv(this.loc('uHueCorDs'), u.hueCorDs);
    gl.uniform1f(
      this.loc('uHueCorOn'),
      u.hueCorDh.some((v) => v !== 0) || u.hueCorDs.some((v) => v !== 0) ? 1 : 0,
    );
    gl.uniform1f(this.loc('uSeed'), 7.13);
    gl.uniform1f(this.loc('uBypass'), opts.bypass ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Upload the measured operator chain: curve stages as a 1024-wide 16-bit
   * table (rows = stage*3 + channel, value in RG bytes) and the matrices
   * between them as mat3 uniforms. MAX_MATS bounds the chain; every
   * relative render of two catalog recipes fits (ops.test.ts).
   */
  private uploadChain(chain: EngineUniforms['chain'], unit: number): void {
    const gl = this.gl;
    const packed = packChain(chain);
    const nMats = Math.min(packed.mats.length, MAX_MATS);
    const nCurves = nMats + 1;
    const rows = nCurves * 3;
    const data = new Uint8Array(CURVE_SAMPLES * rows * 4);
    for (let st = 0; st < nCurves; st++) {
      const tab = packed.curves[st];
      for (let ch = 0; ch < 3; ch++) {
        const row = st * 3 + ch;
        for (let j = 0; j < CURVE_SAMPLES; j++) {
          const v = Math.round(Math.min(1, Math.max(0, tab[ch * CURVE_SAMPLES + j])) * 65535);
          const o = (row * CURVE_SAMPLES + j) * 4;
          data[o] = v >> 8;
          data[o + 1] = v & 255;
          data[o + 2] = 0;
          data[o + 3] = 255;
        }
      }
    }
    if (!this.curveTex) this.curveTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, CURVE_SAMPLES, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.loc('uCurveTex'), unit);
    gl.uniform1f(this.loc('uCurveRows'), rows);
    gl.uniform1i(this.loc('uMatCount'), nMats);
    const mats = new Float32Array(MAX_MATS * 9);
    for (let i = 0; i < nMats; i++) {
      const m = packed.mats[i];
      // GLSL mat3 is column-major; m is row-major.
      mats.set([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]], i * 9);
    }
    gl.uniformMatrix3fv(this.loc('uMat[0]'), false, mats);
  }

  /** Render the current image at full preview resolution and download it. */
  async exportPng(params: RecipeParams, filename: string, baseline?: RecipeParams): Promise<void> {
    this.render(params, { baseline });
    const blob = await new Promise<Blob | null>((resolve) =>
      this.canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private disposeTextures(): void {
    if (!this.textures) return;
    const gl = this.gl;
    gl.deleteTexture(this.textures.image);
    gl.deleteTexture(this.textures.blurSmall);
    gl.deleteTexture(this.textures.blurLarge);
    this.textures = null;
    if (this.curveTex) {
      gl.deleteTexture(this.curveTex);
      this.curveTex = null;
    }
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.onContextLost = null;
    this.disposeTextures();
    this.gl.deleteProgram(this.program);
  }
}
