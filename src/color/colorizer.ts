import type { ColorGrade, ProjectLut } from '../core/types';
import { findLut } from './lut';
import { gradeUniforms, isNeutralGrade } from './wheels';

const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler3D;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform sampler3D u_lut;
uniform float u_useLut;
uniform float u_lutMix;
uniform float u_lutSize;
uniform vec3 u_lutDomainMin;
uniform vec3 u_lutDomainMax;
uniform vec3 u_lift;
uniform vec3 u_gain;
uniform vec3 u_gamma;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_temperature;
uniform float u_hue;

vec3 hueRotate(vec3 color, float angle) {
  const vec3 k = vec3(0.57735026919);
  float c = cos(angle);
  float s = sin(angle);
  return color * c + cross(k, color) * s + k * dot(k, color) * (1.0 - c);
}

void main() {
  vec4 src = texture(u_tex, v_uv);
  vec3 c = src.rgb;
  c *= u_exposure;
  c = (c - 0.5) * u_contrast + 0.5;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, u_saturation);
  c += vec3(u_temperature * 0.08, u_temperature * 0.012, -u_temperature * 0.08);
  c = hueRotate(c, u_hue);
  c = clamp(c, 0.0, 1.0);
  c = c * u_gain + u_lift;
  c = pow(clamp(c, 0.0, 1.0), u_gamma);

  if (u_useLut > 0.5) {
    vec3 n = clamp((c - u_lutDomainMin) / max(u_lutDomainMax - u_lutDomainMin, vec3(1e-5)), 0.0, 1.0);
    vec3 coord = n * (u_lutSize - 1.0) / u_lutSize + 0.5 / u_lutSize;
    vec3 graded = texture(u_lut, coord).rgb;
    c = mix(c, graded, u_lutMix);
  }
  outColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[color] shader compile failed', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function webglAvailable(): boolean {
  // Do not create a probe context here: mobile/headless GPUs can cap the number
  // of live WebGL contexts, and stealing the only slot breaks the real renderer.
  return typeof WebGL2RenderingContext !== 'undefined';
}

class Colorizer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;
  private program: WebGLProgram;
  private sourceTex: WebGLTexture;
  private lutTextures = new Map<string, { texture: WebGLTexture; size: number }>();
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private width = 0;
  private height = 0;
  private lost = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      depth: false,
      stencil: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.scratch = document.createElement('canvas');
    this.scratchCtx = this.scratch.getContext('2d')!;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) throw new Error('Colour shader failed to compile');
    const program = gl.createProgram();
    if (!program) throw new Error('Colour program failed');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Colour program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.sourceTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const names = [
      'u_tex', 'u_lut', 'u_useLut', 'u_lutMix', 'u_lutSize', 'u_lutDomainMin', 'u_lutDomainMax',
      'u_lift', 'u_gain', 'u_gamma', 'u_exposure', 'u_contrast', 'u_saturation', 'u_temperature', 'u_hue',
    ];
    for (const name of names) this.uniforms[name] = gl.getUniformLocation(program, name);
    gl.useProgram(program);
    gl.uniform1i(this.uniforms.u_tex ?? null, 0);
    gl.uniform1i(this.uniforms.u_lut ?? null, 1);

    this.canvas.addEventListener('webglcontextlost', () => {
      this.lost = true;
      failed = true;
      singleton = null;
    });
  }

  private ensureSize(w: number, h: number) {
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.scratch.width = w;
    this.scratch.height = h;
  }

  private lutTexture(id: string, lut: ProjectLut): WebGLTexture | null {
    const key = `${id}:${lut.size}`;
    const hit = this.lutTextures.get(key);
    if (hit) return hit.texture;
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const n = lut.size;
    const pixels = new Uint8Array(n * n * n * 4);
    for (let i = 0; i < n * n * n; i++) {
      pixels[i * 4] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3] ?? 0)) * 255);
      pixels[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3 + 1] ?? 0)) * 255);
      pixels[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3 + 2] ?? 0)) * 255);
      pixels[i * 4 + 3] = 255;
    }
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    this.lutTextures.set(key, { texture, size: n });
    return texture;
  }

  colorize(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    frameWidth: number,
    frameHeight: number,
    fill: boolean,
    grade: ColorGrade | undefined,
    luts: Record<string, ProjectLut> | undefined,
  ): HTMLCanvasElement | null {
    if (this.lost) return null;
    const gl = this.gl;
    this.ensureSize(frameWidth, frameHeight);
    if (!sourceWidth || !sourceHeight) return null;

    const fit = fill ? Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight) : Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
    const dw = sourceWidth * fit;
    const dh = sourceHeight * fit;
    const ctx = this.scratchCtx;
    ctx.clearRect(0, 0, frameWidth, frameHeight);
    try {
      ctx.drawImage(source, (frameWidth - dw) / 2, (frameHeight - dh) / 2, dw, dh);
    } catch {
      return null;
    }

    gl.viewport(0, 0, frameWidth, frameHeight);
    gl.useProgram(this.program);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.scratch);

    const u = gradeUniforms(grade);
    const uu = this.uniforms;
    gl.uniform1f(uu.u_exposure ?? null, u.exposure);
    gl.uniform1f(uu.u_contrast ?? null, u.contrast);
    gl.uniform1f(uu.u_saturation ?? null, u.saturation);
    gl.uniform1f(uu.u_temperature ?? null, u.temperature);
    gl.uniform1f(uu.u_hue ?? null, u.hue);
    gl.uniform3fv(uu.u_lift ?? null, u.lift);
    gl.uniform3fv(uu.u_gain ?? null, u.gain);
    gl.uniform3fv(uu.u_gamma ?? null, u.gamma);

    const lut = findLut(luts, grade?.lutId);
    if (lut) {
      const texture = this.lutTexture(grade?.lutId ?? 'lut', lut);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, texture);
      gl.uniform1f(uu.u_useLut ?? null, 1);
      gl.uniform1f(uu.u_lutSize ?? null, lut.size);
      gl.uniform1f(uu.u_lutMix ?? null, grade?.lutMix ?? 1);
      gl.uniform3fv(uu.u_lutDomainMin ?? null, lut.domainMin ?? [0, 0, 0]);
      gl.uniform3fv(uu.u_lutDomainMax ?? null, lut.domainMax ?? [1, 1, 1]);
    } else {
      gl.uniform1f(uu.u_useLut ?? null, 0);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.flush();
    return this.canvas;
  }
}

let singleton: Colorizer | null = null;
let failed = false;

export function getColorizer(): Colorizer | null {
  if (singleton) return singleton;
  if (failed) return null;
  try {
    singleton = new Colorizer();
    return singleton;
  } catch (err) {
    failed = true;
    console.warn('[color] GPU grading unavailable, using Canvas2D filters', err);
    return null;
  }
}

export function shouldUseGpu(grade: ColorGrade | undefined, bypass: boolean): boolean {
  if (bypass) return false;
  return !isNeutralGrade(grade);
}
