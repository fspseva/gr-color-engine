import { MAX_MATS } from './ops';

export const VERTEX_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  // Flip Y: texture row 0 is the image's top, but GL's v=0 is the bottom.
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/**
 * Single-pass pipeline in camera order:
 * highlight/shadow correction -> measured operator chain in linear light
 * (base look, WB mode, WB shift, tone sliders: curve stages + 3x3 matrices)
 * -> parametric base tone for operator-less looks -> saturation, hue ->
 * detail (clarity/sharpness via pre-blurred textures) -> per-hue residual
 * -> effects (vignette, grain, mono/toning). Gamma 2.2 throughout.
 */
export const FRAGMENT_SRC = `
#define MAX_MATS ${MAX_MATS}
precision highp float;

varying vec2 vUv;

uniform sampler2D uImage;
uniform sampler2D uBlurSmall;
uniform sampler2D uBlurLarge;
uniform vec2 uAspect;       // (aspectX, aspectY) normalized for vignette

uniform sampler2D uCurveTex; // measured operator curves: rows = stage*3+channel, 16-bit in RG
uniform float uCurveRows;
uniform mat3 uMat[MAX_MATS]; // measured operator matrices, between curve stages
uniform int uMatCount;
uniform float uHlCompress;
uniform float uShLift;
uniform float uBlackLift;
uniform float uWhitePoint;
uniform float uGamma;
uniform float uSCurve;
uniform float uSatMul;
uniform float uHueDeg;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uClarityAmt;
uniform float uLocalContrastAmt;
uniform float uSharpAmt;
uniform float uVignetteAmt;
uniform float uGrainAmt;
uniform float uMono;
uniform vec3 uMonoWeights;
uniform vec3 uToningTint;
uniform float uHueCorDh[6];  // per-sector hue correction, degrees
uniform float uHueCorDs[6];  // per-sector saturation correction (HSL S)
uniform float uHueCorOn;
uniform float uSeed;
uniform float uBypass;      // 1.0 = show original (before/after)

vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// One measured curve stage (per-channel): table indexed by gamma-encoded
// input for shadow precision, 16-bit values in RG, linear interpolation.
float curveAt(int row, float x) {
  float t = pow(clamp(x, 0.0, 1.0), 1.0 / 2.2) * 1023.0;
  float i0 = floor(min(t, 1022.0));
  float f = t - i0;
  float v = (float(row) + 0.5) / uCurveRows;
  vec2 a = texture2D(uCurveTex, vec2((i0 + 0.5) / 1024.0, v)).rg;
  vec2 b = texture2D(uCurveTex, vec2((i0 + 1.5) / 1024.0, v)).rg;
  float va = (a.r * 65280.0 + a.g * 255.0) / 65535.0;
  float vb = (b.r * 65280.0 + b.g * 255.0) / 65535.0;
  return mix(va, vb, f);
}
vec3 curve3(int stage, vec3 c) {
  return vec3(curveAt(stage * 3, c.r), curveAt(stage * 3 + 1, c.g), curveAt(stage * 3 + 2, c.b));
}

vec3 hueRotate(vec3 c, float deg) {
  float rad = radians(deg);
  float cs = cos(rad), sn = sin(rad);
  // Rodrigues rotation around the grey axis.
  vec3 k = vec3(0.57735);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
}

vec3 rgb2hslv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float sdiv = 1.0 - abs(2.0 * l - 1.0);
  float s = d < 1e-5 ? 0.0 : d / max(sdiv, 1e-5);
  float h = 0.0;
  if (d > 1e-5) {
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
    if (h < 0.0) h += 1.0;
  }
  return vec3(h, s, l);
}

float hue2chan(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hslv2rgb(vec3 hsl) {
  if (hsl.y < 1e-5) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p2 = 2.0 * hsl.z - q;
  return vec3(hue2chan(p2, q, hsl.x + 1.0 / 3.0), hue2chan(p2, q, hsl.x), hue2chan(p2, q, hsl.x - 1.0 / 3.0));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Smooth S-curve around 0.5; k>0 increases contrast, k<0 flattens.
float scurve(float x, float k) {
  float s = x + k * (x - 0.5) * (1.0 - abs(2.0 * x - 1.0));
  return clamp(s, 0.0, 1.0);
}

void main() {
  vec3 srgb = texture2D(uImage, vUv).rgb;
  if (uBypass > 0.5) {
    gl_FragColor = vec4(srgb, 1.0);
    return;
  }

  vec3 c = toLinear(srgb);

  // 1. Highlight / shadow correction: pre-flatten before the look.
  float y0 = luma(c);
  float hlFactor = 1.0 - uHlCompress * smoothstep(0.55, 1.0, y0) * 0.45;
  float shFactor = 1.0 + uShLift * (1.0 - smoothstep(0.0, 0.45, y0)) * 0.9;
  c *= hlFactor * shFactor;

  // 2. Measured operators in linear light: base look, WB mode, WB shift,
  // tone sliders — alternating per-channel curve stages and 3x3 matrices
  // (for a decoded original, the inverse of its own operators come first).
  c = curve3(0, c);
  for (int i = 0; i < MAX_MATS; i++) {
    if (i >= uMatCount) break;
    c = uMat[i] * c;
    c = curve3(i + 1, c);
  }

  // 3. Parametric base tone for looks without a measured operator
  // (monochromes, HDR Tone), in gamma space.
  vec3 g = toSrgb(c);
  float k = uSCurve;
  g = vec3(scurve(g.r, k), scurve(g.g, k), scurve(g.b, k));

  // Black lift and white point.
  g = g * (uWhitePoint - uBlackLift) + uBlackLift;

  // Midtone gamma.
  g = pow(clamp(g, 0.0, 1.0), vec3(uGamma));

  // Split tints (shadows / highlights).
  float y2 = luma(g);
  g += uShadowTint * (1.0 - smoothstep(0.0, 0.6, y2));
  g += uHighlightTint * smoothstep(0.4, 1.0, y2);

  // Saturation and hue.
  float yl = luma(g);
  g = mix(vec3(yl), g, uSatMul);
  if (abs(uHueDeg) > 0.01) g = hueRotate(g, uHueDeg);

  // 5. Detail: clarity + HDR local contrast (large blur), sharpness (small blur).
  vec3 blurL = texture2D(uBlurLarge, vUv).rgb;
  vec3 blurS = texture2D(uBlurSmall, vUv).rgb;
  float localAmt = uClarityAmt + uLocalContrastAmt;
  g += (g - blurL) * localAmt;
  g += (g - blurS) * uSharpAmt;

  // 6. Effects.
  // Vignette (positive darkens corners).
  vec2 d = (vUv - 0.5) * uAspect;
  float r = length(d) * 1.414;
  float vig = 1.0 - uVignetteAmt * smoothstep(0.45, 1.1, r);
  g *= vig;

  // Measured per-hue color geometry (display space; sector centers at
  // 0/52/120/185/230/295 degrees, circularly interpolated; near-neutrals
  // fade out to avoid noise). Hue is shifted in degrees; saturation is
  // scaled (measured 2026-09: the camera's per-hue chroma changes are
  // proportional to chroma, an additive offset over-corrects pastels).
  if (uHueCorOn > 0.5 && uMono < 0.5) {
    vec3 hsl = rgb2hslv(clamp(g, 0.0, 1.0));
    float hd = hsl.x * 360.0;
    float dh; float ds; float t;
    if (hd < 52.0)       { t = hd / 52.0;             dh = mix(uHueCorDh[0], uHueCorDh[1], t); ds = mix(uHueCorDs[0], uHueCorDs[1], t); }
    else if (hd < 120.0) { t = (hd - 52.0) / 68.0;    dh = mix(uHueCorDh[1], uHueCorDh[2], t); ds = mix(uHueCorDs[1], uHueCorDs[2], t); }
    else if (hd < 185.0) { t = (hd - 120.0) / 65.0;   dh = mix(uHueCorDh[2], uHueCorDh[3], t); ds = mix(uHueCorDs[2], uHueCorDs[3], t); }
    else if (hd < 230.0) { t = (hd - 185.0) / 45.0;   dh = mix(uHueCorDh[3], uHueCorDh[4], t); ds = mix(uHueCorDs[3], uHueCorDs[4], t); }
    else if (hd < 295.0) { t = (hd - 230.0) / 65.0;   dh = mix(uHueCorDh[4], uHueCorDh[5], t); ds = mix(uHueCorDs[4], uHueCorDs[5], t); }
    else                 { t = (hd - 295.0) / 65.0;   dh = mix(uHueCorDh[5], uHueCorDh[0], t); ds = mix(uHueCorDs[5], uHueCorDs[0], t); }
    float w = smoothstep(0.05, 0.14, hsl.y);
    hsl.x = fract(hsl.x + (dh / 360.0) * w + 1.0);
    hsl.y = clamp(hsl.y * (1.0 + ds * w), 0.0, 1.0);
    g = hslv2rgb(hsl);
  }

  // Mono conversion, filter effect, toning.
  if (uMono > 0.5) {
    float m = dot(max(g, 0.0), uMonoWeights);
    g = vec3(m);
    float mid = 1.0 - abs(2.0 * m - 1.0);
    g += uToningTint * mid;
  }

  // Grain (luminance noise, stronger in midtones).
  if (uGrainAmt > 0.001) {
    float n = hash(vUv * vec2(1913.0, 1117.0) + uSeed) - 0.5;
    float mid = 1.0 - abs(2.0 * clamp(luma(g), 0.0, 1.0) - 1.0);
    g += n * uGrainAmt * 0.14 * (0.35 + 0.65 * mid);
  }

  gl_FragColor = vec4(clamp(g, 0.0, 1.0), 1.0);
}
`;
