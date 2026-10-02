// WebGL2 renderer of the graph: everything is instanced and reads node data from textures, so a frame is a
// handful of draw calls whatever the graph size, and a simulation tick is a single position texture upload.
//   - positions (RG32F), radius + appear time (RG32F) and color (RGBA8) per node live in textures indexed by
//     node index; links are instances of (source | dir << 30, target) that look their endpoints up there
//   - nodes: SDF circles, links: screen-space antialiased quads, arrows: instanced triangles
//   - hover: everything is dimmed by a uniform and the hovered neighbourhood is drawn again on top from small
//     index buffers, so changing the hover never touches the per-node data
//   - labels: rasterized once per size into a texture atlas (text coverage in R, halo coverage in G, colored in
//     the shader, so theme changes are free) and drawn as instanced textured quads
import { POS_TEX_W } from './sim'
import { DIRTY_ALL, DIRTY_COLORS, DIRTY_EDGES, DIRTY_HL, DIRTY_POS, DIRTY_PROPS, type FrameParams, type GNode, type Renderer, type Scene } from './scene'

const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPos;
uniform sampler2D uProps;
uniform vec3 uCam;
uniform vec2 uView;
uniform float uDpr;
uniform float uTime;
uniform float uMinR;
ivec2 tc(uint i) { return ivec2(int(i & ${POS_TEX_W - 1}u), int(i >> ${Math.log2(POS_TEX_W)}u)); }
vec2 nodePos(uint i) { return texelFetch(uPos, tc(i), 0).xy; }
vec2 nodeProps(uint i) { return texelFetch(uProps, tc(i), 0).xy; }
float appear(float t0) { return clamp((uTime - t0) / 450.0, 0.0, 1.0); }
vec2 toScreen(vec2 w) { return w * uCam.z + uCam.xy; }
vec4 toClip(vec2 css) { return vec4(css.x / uView.x * 2.0 - 1.0, 1.0 - css.y / uView.y * 2.0, 0.0, 1.0); }
`

const NODE_VS = /* glsl */ `${COMMON}
uniform sampler2D uColor;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in uint aIdx;
uniform float uAlpha;
uniform int uMode;          // 0 fill, 1 ring
uniform uint uAccentIdx;    // node drawn with the accent color mixed in by uAccentMix
uniform float uAccentMix;
uniform vec4 uAccent;
out vec2 vLocal;
out float vR;
out float vHalfW;
out vec4 vColor;
void main() {
  vec2 pr = nodeProps(aIdx);
  float ap = appear(pr.y);
  vec4 c = texelFetch(uColor, tc(aIdx), 0);
  if (aIdx == uAccentIdx) c = mix(c, uAccent, uAccentMix);
  float r = max(pr.x * uCam.z, uMinR);
  float a = uAlpha * c.a;
  float halfW = 0.0;
  if (uMode == 1) {
    r += 3.0;
    halfW = 0.75 * uDpr;
  } else {
    r *= 0.5 + 0.5 * ap;
    a *= ap;
  }
  float rd = r * uDpr;
  float ext = rd + halfW + 1.0;
  vLocal = aCorner * ext;
  vR = rd;
  vHalfW = halfW;
  vColor = vec4(c.rgb * a, a);
  gl_Position = toClip(toScreen(nodePos(aIdx)) + aCorner * ext / uDpr);
}`

const NODE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in float vR;
in float vHalfW;
in vec4 vColor;
out vec4 o;
void main() {
  float d = length(vLocal);
  float cov = vHalfW > 0.0 ? clamp(vHalfW - abs(d - vR) + 0.5, 0.0, 1.0) : clamp(vR - d + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  o = vColor * cov;
}`

const EDGE_VS = /* glsl */ `${COMMON}
layout(location = 0) in vec2 aCorner;   // x: 0 at source, 1 at target; y: -1 / 1 across
layout(location = 1) in uvec2 aEdge;
uniform float uWidth;   // CSS px
uniform float uAlpha;
uniform vec4 uLine;
out float vDist;
out float vHalf;
out vec4 vColor;
void main() {
  uint s = aEdge.x & 0x3FFFFFFFu;
  uint t = aEdge.y;
  float ap = min(appear(nodeProps(s).y), appear(nodeProps(t).y));
  vec2 a = toScreen(nodePos(s)) * uDpr;
  vec2 b = toScreen(nodePos(t)) * uDpr;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = uWidth * uDpr;
  float wd = max(w, 1.0);
  // just wide enough for the antialiased edge (coverage reaches 0 half a pixel outside the line)
  float h = wd * 0.5 + 0.5;
  vec2 p = mix(a, b, aCorner.x) + nrm * aCorner.y * h;
  vDist = aCorner.y * h;
  vHalf = wd * 0.5;
  float al = uAlpha * ap * min(w, 1.0) * uLine.a;
  vColor = vec4(uLine.rgb * al, al);
  gl_Position = toClip(p / uDpr);
}`

const EDGE_FS = /* glsl */ `#version 300 es
precision highp float;
in float vDist;
in float vHalf;
in vec4 vColor;
out vec4 o;
void main() {
  float cov = clamp(vHalf - abs(vDist) + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  o = vColor * cov;
}`

const ARROW_VS = /* glsl */ `${COMMON}
layout(location = 1) in uvec2 aEdge;
uniform uint uBit;      // 1: arrow at the target, 2: arrow at the source
uniform float uSize;    // world units
uniform float uAlpha;
uniform vec4 uLine;
out vec4 vColor;
out vec3 vBary;
void main() {
  uint s = aEdge.x & 0x3FFFFFFFu;
  uint t = aEdge.y;
  uint dir = aEdge.x >> 30;
  vBary = gl_VertexID == 0 ? vec3(1.0, 0.0, 0.0) : gl_VertexID == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  if ((dir & uBit) == 0u) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (uBit == 2u) { uint x = s; s = t; t = x; }
  vec2 from = nodePos(s);
  vec2 to = nodePos(t);
  vec2 pt = nodeProps(t);
  float ap = min(appear(nodeProps(s).y), appear(pt.y));
  float r = max(pt.x, uMinR / uCam.z);
  vec2 d = to - from;
  float len = length(d);
  if (len < r + uSize) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 u = d / len;
  vec2 tip = to - u * (r + 1.0 / uCam.z);
  vec2 base = tip - u * uSize;
  vec2 perp = vec2(-u.y, u.x) * uSize * 0.45;
  vec2 p = gl_VertexID == 0 ? tip : gl_VertexID == 1 ? base - perp : base + perp;
  float al = uAlpha * ap * uLine.a;
  vColor = vec4(uLine.rgb * al, al);
  gl_Position = toClip(toScreen(p));
}`

const ARROW_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in vec3 vBary;
out vec4 o;
void main() {
  // antialiased triangle edges: distance to the nearest edge in pixels via the barycentric derivatives
  vec3 d = vBary / max(fwidth(vBary), vec3(1e-6));
  float cov = clamp(min(d.x, min(d.y, d.z)) + 0.5, 0.0, 1.0);
  o = vColor * cov;
}`

const LABEL_VS = /* glsl */ `${COMMON}
layout(location = 0) in vec2 aCorner;   // 0..1
layout(location = 1) in uint aIdx;
layout(location = 2) in vec4 aRect;     // atlas x, y, w, h (texels)
layout(location = 3) in vec4 aParam;    // alpha, scale (device px per texel), pad x, pad y (texels)
uniform vec2 uAtlas;
out vec2 vUV;
out float vAlpha;
void main() {
  vec2 c = toScreen(nodePos(aIdx));
  float r = max(nodeProps(aIdx).x * uCam.z, uMinR);
  float s = aParam.y;
  vec2 o = vec2(c.x * uDpr - aRect.z * s * 0.5, (c.y + r + 4.0) * uDpr - aParam.w * s);
  // texel-exact placement when drawn 1:1 keeps the text crisp
  if (abs(s - 1.0) < 0.002) o = floor(o + 0.5);
  vec2 p = o + aCorner * aRect.zw * s;
  vUV = (aRect.xy + aCorner * aRect.zw) / uAtlas;
  vAlpha = aParam.x;
  gl_Position = toClip(p / uDpr);
}`

const LABEL_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uAtlasTex;
uniform vec4 uText;
uniform vec4 uHalo;
in vec2 vUV;
in float vAlpha;
out vec4 o;
void main() {
  vec2 s = texture(uAtlasTex, vUV).rg;
  float h = 0.85 * s.g * (1.0 - s.r);
  float a = s.r + h;
  if (a <= 0.0) discard;
  o = vec4(uText.rgb * s.r + uHalo.rgb * h, a) * vAlpha;
}`

const LAYER_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;   // 0..1
uniform vec4 uRect;                     // screen CSS px: x0, y0, x1, y1
uniform vec2 uView;
out vec2 vUV;
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aCorner);
  vUV = vec2(aCorner.x, 1.0 - aCorner.y);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`

const LAYER_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uLayer;
uniform float uAlpha;
in vec2 vUV;
out vec4 o;
void main() { o = texture(uLayer, vUV) * uAlpha; }`

/** graphs with at least this many links draw them through the cached edge layer */
const LAYER_MIN_EDGES = 60000
/** extra layer area around the viewport (fraction of its size per side) so panning reuses the layer */
const LAYER_MARGIN = 0.2

interface ProgInfo {
  prog: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
  /** last values set per uniform (redundant WebGL calls are skipped) */
  c: Record<string, number[]>
}

interface LabelSlot {
  gen: number
  x: number
  y: number
  w: number
  h: number
  /** device font size it was rasterized at */
  size: number
  padX: number
  padY: number
  font: string
}

interface Shelf {
  y: number
  h: number
  x: number
}

const MAX_LABELS = 2048
/** main-thread time per frame spent rasterizing new labels (the rest appear over the next frames) */
const LABEL_BUDGET_MS = 1.2

/**
 * Label texture atlas: shelf-packed, cleared when full (labels are re-rasterized on demand).
 * Texels hold text coverage in R and halo coverage in G; the label shader colors them, so a theme change only
 * needs a re-raster when the text flips between light and dark (glyph contrast depends on it, see `raster`).
 */
class LabelAtlas {
  readonly w: number
  readonly h: number
  gen = 1
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  private shelves: Shelf[] = []
  private bottom = 0
  private font = ''
  /** text luminance the atlas was rasterized for (glyph contrast depends on it) */
  private lum = -1

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
    this.ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
  }

  /** fraction of the atlas height in use */
  get fill(): number {
    return this.bottom / this.h
  }

  clear(): void {
    this.gen++
    this.shelves = []
    this.bottom = 0
  }

  /** clear when the text luminance changed noticeably (theme switch) */
  setLuminance(lum: number): void {
    if (Math.abs(lum - this.lum) < 0.02) return
    this.lum = lum
    this.clear()
  }

  /**
   * Rasterize `text` at `size` device px and upload it into the bound texture; null when the atlas is full.
   * Skia picks glyph contrast / gamma from the luminance of the fill color, so text is drawn in a gray of the
   * theme's text luminance — additively on black for light text, multiplied onto white for dark text — and the
   * coverages are recovered from that: labels look exactly like fillText in the theme's text color.
   */
  raster(gl: WebGL2RenderingContext, text: string, size: number, font: string, dpr: number): LabelSlot | null {
    const ctx = this.ctx
    const f = `${size}px ${font}`
    if (this.font !== f) ctx.font = this.font = f
    const halo = 1.5 * dpr
    const pad = Math.ceil(halo + 1)
    const tw = Math.ceil(ctx.measureText(text).width)
    const w = Math.min(this.w - 2, tw + pad * 2)
    const h = Math.ceil(size * 1.3) + pad * 2
    const pos = this.alloc(w + 1, h + 1)
    if (!pos) return null
    const { x, y } = pos
    const light = this.lum >= 0.5
    const g = Math.round(clamp01(light ? this.lum : Math.max(this.lum, 0.02)) * 255)
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = light ? '#000' : '#fff'
    ctx.fillRect(x, y, w, h)
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.lineJoin = 'round'
    ctx.lineWidth = halo * 2
    // halo → blue channel (added on black / removed from white)
    ctx.strokeStyle = light ? '#0000ff' : '#ffff00'
    ctx.strokeText(text, x + pad, y + pad)
    ctx.globalCompositeOperation = light ? 'lighter' : 'multiply'
    ctx.fillStyle = `rgb(${g},${g},${g})`
    ctx.fillText(text, x + pad, y + pad)
    ctx.restore()
    const img = ctx.getImageData(x, y, w, h)
    const d = img.data
    const gn = g / 255
    for (let i = 0; i < d.length; i += 4) {
      let t: number
      let hc: number
      if (light) {
        t = d[i] / 255 / gn
        hc = d[i + 2] / 255
      } else {
        const rn = d[i] / 255
        t = (1 - rn) / (1 - gn)
        hc = rn > 0.004 ? 1 - d[i + 2] / 255 / rn : 1
      }
      d[i] = Math.round(clamp01(t) * 255)
      d[i + 1] = Math.round(clamp01(hc) * 255)
      d[i + 2] = 0
      d[i + 3] = 255
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, d)
    return { gen: this.gen, x, y, w, h, size, padX: pad, padY: pad, font }
  }

  private alloc(w: number, h: number): { x: number; y: number } | null {
    for (const s of this.shelves)
      if (s.h >= h && s.h <= h * 1.3 + 2 && this.w - s.x >= w) {
        const x = s.x
        s.x += w
        return { x, y: s.y }
      }
    if (this.bottom + h > this.h) return null
    const s = { y: this.bottom, h, x: w }
    this.shelves.push(s)
    this.bottom += h
    return { x: 0, y: s.y }
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export class GLRenderer implements Renderer {
  readonly kind = 'webgl2'
  lost = false
  onRestore: (() => void) | null = null
  private canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private width = 0
  private height = 0
  private dpr = 1

  private pNode!: ProgInfo
  private pEdge!: ProgInfo
  private pArrow!: ProgInfo
  private pLabel!: ProgInfo
  private pLayer!: ProgInfo
  private texPos!: WebGLTexture
  private texProps!: WebGLTexture
  private texColor!: WebGLTexture
  private texAtlas!: WebGLTexture
  /** cached edge layer (large graphs): links + arrows rendered off screen, composited every frame */
  private layerTex: WebGLTexture | null = null
  private layerFbo: WebGLFramebuffer | null = null
  private layerW = 0
  private layerH = 0
  /** camera (CSS px, incl. the margin) and state the layer was rendered with */
  private layerCam = { x: 0, y: 0, k: 1, cx: 0, cy: 0, w: 0, h: 0, res: 0 }
  private layerParams = new Float64Array(9).fill(NaN)
  private layerVer = -1
  /** bumped whenever link geometry inputs (positions, radii / appear times, links) are uploaded */
  private edgeVer = 0
  /** signals when the last layer render finished on the GPU: at most one is in flight, so a heavy graph can
   * never queue up GPU work faster than it completes (frames keep compositing the previous layer meanwhile) */
  private layerFence: WebGLSync | null = null
  /** a wanted layer render was deferred (the caller should draw another frame) */
  private layerPending = false
  private bufNodeCorner!: WebGLBuffer
  private bufEdgeCorner!: WebGLBuffer
  private bufLabelCorner!: WebGLBuffer
  private bufIdentity!: WebGLBuffer
  private bufHlNodes!: WebGLBuffer
  private bufFocus!: WebGLBuffer
  private bufEdges!: WebGLBuffer
  private bufHlEdges!: WebGLBuffer
  private bufLabelIdx!: WebGLBuffer
  private bufLabelRect!: WebGLBuffer
  private bufLabelParam!: WebGLBuffer
  private vaoNodes!: WebGLVertexArrayObject
  private vaoHlNodes!: WebGLVertexArrayObject
  private vaoFocus!: WebGLVertexArrayObject
  private vaoEdges!: WebGLVertexArrayObject
  private vaoHlEdges!: WebGLVertexArrayObject
  private vaoLabels!: WebGLVertexArrayObject

  /** texture rows currently allocated for the per-node textures */
  private rows = 0
  private identityLen = 0
  private edgeCap = 0
  private hlNodeCap = 0
  private hlEdgeCap = 0
  private focusIdx = -1
  private forceUpload = true

  private atlas: LabelAtlas
  private labelIdx = new Uint32Array(MAX_LABELS)
  private labelRect = new Float32Array(MAX_LABELS * 4)
  private labelParam = new Float32Array(MAX_LABELS * 4)
  private pixel = new Uint8Array(4)
  private one = new Uint32Array(1)
  private mixed = new Float32Array(4)

  static create(canvas: HTMLCanvasElement): GLRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      // everything antialiases analytically in its shader; MSAA would only multiply the blending bandwidth
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    })
    if (!gl) return null
    try {
      return new GLRenderer(canvas, gl)
    } catch (e) {
      console.warn('graph: WebGL2 renderer unavailable, using Canvas 2D', e)
      return null
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas
    this.gl = gl
    const big = (window.devicePixelRatio || 1) >= 1.5
    this.atlas = new LabelAtlas(big ? 4096 : 2048, 2048)
    this.init()
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
  }

  private onLost = (e: Event): void => {
    e.preventDefault()
    this.lost = true
  }

  private onRestored = (): void => {
    this.lost = false
    this.init()
    this.onRestore?.()
  }

  /** (re)create every GL resource; data is re-uploaded on the next draw */
  private init(): void {
    const gl = this.gl
    this.pNode = this.program(NODE_VS, NODE_FS)
    this.pEdge = this.program(EDGE_VS, EDGE_FS)
    this.pArrow = this.program(ARROW_VS, ARROW_FS)
    this.pLabel = this.program(LABEL_VS, LABEL_FS)
    this.pLayer = this.program(LAYER_VS, LAYER_FS)
    this.texPos = this.texture(gl.NEAREST)
    this.texProps = this.texture(gl.NEAREST)
    this.texColor = this.texture(gl.NEAREST)
    this.texAtlas = this.texture(gl.LINEAR)
    this.layerTex = null
    this.layerFbo = null
    this.layerW = this.layerH = 0
    this.layerVer = -1
    this.layerFence = null
    this.layerPending = false
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.atlas.w, this.atlas.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    this.atlas.clear()

    this.bufNodeCorner = this.staticBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]))
    this.bufEdgeCorner = this.staticBuffer(new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]))
    this.bufLabelCorner = this.staticBuffer(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]))
    this.bufIdentity = gl.createBuffer()!
    this.bufHlNodes = gl.createBuffer()!
    this.bufFocus = this.staticBuffer(new Uint32Array([0]))
    this.bufEdges = gl.createBuffer()!
    this.bufHlEdges = gl.createBuffer()!
    this.bufLabelIdx = gl.createBuffer()!
    this.bufLabelRect = gl.createBuffer()!
    this.bufLabelParam = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLabelIdx)
    gl.bufferData(gl.ARRAY_BUFFER, this.labelIdx.byteLength, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLabelRect)
    gl.bufferData(gl.ARRAY_BUFFER, this.labelRect.byteLength, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLabelParam)
    gl.bufferData(gl.ARRAY_BUFFER, this.labelParam.byteLength, gl.DYNAMIC_DRAW)

    this.vaoNodes = this.nodeVao(this.bufIdentity)
    this.vaoHlNodes = this.nodeVao(this.bufHlNodes)
    this.vaoFocus = this.nodeVao(this.bufFocus)
    this.vaoEdges = this.edgeVao(this.bufEdges)
    this.vaoHlEdges = this.edgeVao(this.bufHlEdges)
    const vl = gl.createVertexArray()!
    gl.bindVertexArray(vl)
    this.attrib(this.bufLabelCorner, 0, 2, 0)
    this.attribU(this.bufLabelIdx, 1, 1, 1)
    this.attrib(this.bufLabelRect, 2, 4, 1)
    this.attrib(this.bufLabelParam, 3, 4, 1)
    this.vaoLabels = vl
    gl.bindVertexArray(null)

    this.rows = 0
    this.identityLen = 0
    this.edgeCap = 0
    this.hlNodeCap = 0
    this.hlEdgeCap = 0
    this.focusIdx = -1
    this.forceUpload = true

    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  }

  private program(vs: string, fs: string): ProgInfo {
    const gl = this.gl
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
    const u: Record<string, WebGLUniformLocation | null> = {}
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog, i)
      if (info) u[info.name] = gl.getUniformLocation(prog, info.name)
    }
    gl.useProgram(prog)
    // fixed texture units
    if (u.uPos) gl.uniform1i(u.uPos, 0)
    if (u.uProps) gl.uniform1i(u.uProps, 1)
    if (u.uColor) gl.uniform1i(u.uColor, 2)
    if (u.uAtlasTex) gl.uniform1i(u.uAtlasTex, 3)
    if (u.uLayer) gl.uniform1i(u.uLayer, 4)
    return { prog, u, c: {} }
  }

  private texture(filter: number): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  private staticBuffer(data: Float32Array | Uint32Array): WebGLBuffer {
    const gl = this.gl
    const b = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    return b
  }

  private attrib(buf: WebGLBuffer, loc: number, size: number, divisor: number): void {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(loc, divisor)
  }

  private attribU(buf: WebGLBuffer, loc: number, size: number, divisor: number): void {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribIPointer(loc, size, gl.UNSIGNED_INT, 0, 0)
    gl.vertexAttribDivisor(loc, divisor)
  }

  private nodeVao(idx: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl
    const v = gl.createVertexArray()!
    gl.bindVertexArray(v)
    this.attrib(this.bufNodeCorner, 0, 2, 0)
    this.attribU(idx, 1, 1, 1)
    gl.bindVertexArray(null)
    return v
  }

  private edgeVao(edges: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl
    const v = gl.createVertexArray()!
    gl.bindVertexArray(v)
    this.attrib(this.bufEdgeCorner, 0, 2, 0)
    this.attribU(edges, 1, 2, 1)
    gl.bindVertexArray(null)
    return v
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.dpr = dpr
  }

  resetLabels(): void {
    this.atlas.clear()
  }

  invalidate(): void {
    this.layerVer = -1
    // a forced redraw must not be deferred behind the previous layer's fence
    if (this.layerFence) this.gl.deleteSync(this.layerFence)
    this.layerFence = null
  }

  // ---------------------------------------------------------------- uploads

  private upload(scene: Scene): void {
    const gl = this.gl
    let dirty = scene.dirty
    if (this.forceUpload) dirty = DIRTY_ALL
    this.forceUpload = false
    scene.dirty = 0
    const rows = scene.cap / POS_TEX_W
    if (rows !== this.rows) {
      this.rows = rows
      dirty = DIRTY_ALL
      gl.bindTexture(gl.TEXTURE_2D, this.texPos)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, POS_TEX_W, rows, 0, gl.RG, gl.FLOAT, null)
      gl.bindTexture(gl.TEXTURE_2D, this.texProps)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, POS_TEX_W, rows, 0, gl.RG, gl.FLOAT, null)
      gl.bindTexture(gl.TEXTURE_2D, this.texColor)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, POS_TEX_W, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
    if (dirty & (DIRTY_POS | DIRTY_PROPS | DIRTY_EDGES)) this.edgeVer++
    if (dirty & DIRTY_POS) {
      gl.bindTexture(gl.TEXTURE_2D, this.texPos)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, POS_TEX_W, rows, gl.RG, gl.FLOAT, scene.pos, 0)
    }
    if (dirty & DIRTY_PROPS) {
      gl.bindTexture(gl.TEXTURE_2D, this.texProps)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, POS_TEX_W, rows, gl.RG, gl.FLOAT, scene.props, 0)
    }
    if (dirty & DIRTY_COLORS) {
      gl.bindTexture(gl.TEXTURE_2D, this.texColor)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, POS_TEX_W, rows, gl.RGBA, gl.UNSIGNED_BYTE, scene.colors, 0)
    }
    if (dirty & DIRTY_EDGES) {
      if (scene.n > this.identityLen) {
        const cap = Math.max(scene.n, this.identityLen * 2, 1024)
        const ids = new Uint32Array(cap)
        for (let i = 0; i < cap; i++) ids[i] = i
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufIdentity)
        gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW)
        this.identityLen = cap
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufEdges)
      if (scene.edges.length > this.edgeCap) {
        this.edgeCap = scene.edges.length
        gl.bufferData(gl.ARRAY_BUFFER, scene.edges, gl.STATIC_DRAW)
      } else gl.bufferSubData(gl.ARRAY_BUFFER, 0, scene.edges, 0, scene.m * 2)
    }
    if (dirty & DIRTY_HL) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufHlNodes)
      if (scene.hlNodes.length > this.hlNodeCap) {
        this.hlNodeCap = scene.hlNodes.length
        gl.bufferData(gl.ARRAY_BUFFER, scene.hlNodes, gl.DYNAMIC_DRAW)
      } else if (scene.hlNodeCount) gl.bufferSubData(gl.ARRAY_BUFFER, 0, scene.hlNodes, 0, scene.hlNodeCount)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufHlEdges)
      if (scene.hlEdges.length > this.hlEdgeCap) {
        this.hlEdgeCap = scene.hlEdges.length
        gl.bufferData(gl.ARRAY_BUFFER, scene.hlEdges, gl.DYNAMIC_DRAW)
      } else if (scene.hlEdgeCount) gl.bufferSubData(gl.ARRAY_BUFFER, 0, scene.hlEdges, 0, scene.hlEdgeCount * 2)
    }
  }

  // ---------------------------------------------------------------- draw

  draw(scene: Scene, f: FrameParams): boolean {
    const gl = this.gl
    if (this.lost || gl.isContextLost()) return false
    const W = Math.max(1, Math.round(this.width * this.dpr))
    const H = Math.max(1, Math.round(this.height * this.dpr))
    gl.viewport(0, 0, W, H)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!scene.n) return false
    this.upload(scene)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texPos)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.texProps)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.texColor)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.texAtlas)

    const hl = f.fade > 0 && f.hlSource >= 0
    // highlighted links / arrows: line color blending into the accent as the hover fades in
    const hlColor = this.mixed
    for (let i = 0; i < 4; i++) hlColor[i] = f.line[i] + (f.accent[i] - f.line[i]) * f.fade

    // ---- links (+ arrows): live, or composited from the cached layer on large graphs
    const pe = this.pEdge
    const layered = scene.m >= LAYER_MIN_EDGES && this.drawLayer(scene, f, W, H)
    this.use(pe, f)
    if (scene.m && !layered) {
      this.uf(pe, 'uWidth', f.linePx)
      this.uf(pe, 'uAlpha', f.dimEdge)
      this.uf4(pe, 'uLine', f.line)
      gl.bindVertexArray(this.vaoEdges)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.m)
    }
    if (hl && scene.hlEdgeCount) {
      this.uf(pe, 'uWidth', f.linePx * (1 + 0.5 * f.fade))
      this.uf(pe, 'uAlpha', 1)
      this.uf4(pe, 'uLine', hlColor)
      gl.bindVertexArray(this.vaoHlEdges)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.hlEdgeCount)
    }

    // ---- arrows
    if (f.arrowAlpha > 0 && scene.m) {
      this.use(this.pArrow, f)
      this.uf(this.pArrow, 'uSize', f.arrowSize)
      if (!layered) this.arrows(this.vaoEdges, scene.m, f.arrowAlpha * f.dimEdge, f.line)
      if (hl && scene.hlEdgeCount) this.arrows(this.vaoHlEdges, scene.hlEdgeCount, f.arrowAlpha, hlColor)
    }

    // ---- nodes
    const pn = this.pNode
    this.use(pn, f)
    this.uf4(pn, 'uAccent', f.accent)
    this.ui(pn, 'uMode', 0)
    this.uu(pn, 'uAccentIdx', 0xffffffff)
    this.uf(pn, 'uAlpha', f.dimNode)
    gl.bindVertexArray(this.vaoNodes)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.n)
    if (hl && scene.hlNodeCount) {
      this.uf(pn, 'uAlpha', 1)
      this.uu(pn, 'uAccentIdx', f.hlSource)
      this.uf(pn, 'uAccentMix', f.fade)
      gl.bindVertexArray(this.vaoHlNodes)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.hlNodeCount)
    }
    if (f.focus >= 0 && f.focusAlpha > 0) {
      if (f.focus !== this.focusIdx) {
        this.focusIdx = f.focus
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufFocus)
        this.one[0] = f.focus
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.one)
      }
      this.ui(pn, 'uMode', 1)
      this.uu(pn, 'uAccentIdx', f.focus)
      this.uf(pn, 'uAccentMix', 1)
      this.uf(pn, 'uAlpha', f.focusAlpha)
      gl.bindVertexArray(this.vaoFocus)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1)
    }

    // ---- labels
    const more = this.drawLabels(scene, f)
    gl.bindVertexArray(null)
    return more || this.layerPending
  }

  /**
   * Composite the cached edge layer, re-rendering it first when needed. The layer is re-rendered when the link
   * geometry or style changed, when the camera left what it covers or scaled too far, and — at half resolution —
   * while the camera moves or the layout settles; once everything rests it is redrawn at full resolution so the
   * resting picture is pixel-identical to drawing the links directly.
   */
  private drawLayer(scene: Scene, f: FrameParams, W: number, H: number): boolean {
    const gl = this.gl
    const L = this.layerCam
    const res = f.moving ? 0.5 : 1
    // style inputs of the cached picture
    const P = this.layerParams
    const changed =
      P[0] !== f.linePx || P[1] !== f.arrowAlpha || P[2] !== f.arrowSize || P[3] !== f.line[0] || P[4] !== f.line[1] ||
      P[5] !== f.line[2] || P[6] !== f.line[3] || P[7] !== W || P[8] !== H
    let need = changed || this.layerVer !== this.edgeVer || !this.layerFbo
    const s = f.cam.k / L.k
    if (!need) {
      // layer rect on screen (CSS px)
      const x0 = -L.x * s + f.cam.x
      const y0 = -L.y * s + f.cam.y
      const x1 = (L.w - L.x) * s + f.cam.x
      const y1 = (L.h - L.y) * s + f.cam.y
      const covers = x0 <= 0.5 && y0 <= 0.5 && x1 >= this.width - 0.5 && y1 >= this.height - 0.5
      if (!covers || s < 0.7 || s > 1.5) need = true
      else if (!f.moving) {
        // at rest: redraw unless the layer maps 1:1 onto whole device pixels at full resolution
        const ox = (f.cam.x - L.cx) * (W / this.width)
        const oy = (f.cam.y - L.cy) * (H / this.height)
        need = L.res !== 1 || s !== 1 || Math.abs(ox - Math.round(ox)) > 0.01 || Math.abs(oy - Math.round(oy)) > 0.01
      }
    }
    this.layerPending = false
    if (need) {
      const fence = this.layerFence
      if (fence && this.layerFbo && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) this.layerPending = true
      else {
        if (fence) gl.deleteSync(fence)
        this.renderLayer(scene, f, W, H, res)
        this.layerFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      }
    }

    // composite
    const p = this.pLayer
    const k = f.cam.k / L.k
    gl.useProgram(p.prog)
    this.uf(p, 'uRect', -L.x * k + f.cam.x, -L.y * k + f.cam.y, (L.w - L.x) * k + f.cam.x, (L.h - L.y) * k + f.cam.y)
    this.uf(p, 'uView', this.width, this.height)
    this.uf(p, 'uAlpha', f.dimEdge)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, this.layerTex)
    gl.bindVertexArray(this.vaoLabels)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return true
  }

  private renderLayer(scene: Scene, f: FrameParams, W: number, H: number, res: number): void {
    const gl = this.gl
    const L = this.layerCam
    // margins in whole device pixels and the canvas' own CSS → device scale, so a resting layer maps 1:1
    const sx = W / this.width
    const sy = H / this.height
    const mxd = Math.round(W * LAYER_MARGIN)
    const myd = Math.round(H * LAYER_MARGIN)
    const lw = Math.max(1, Math.round((W + 2 * mxd) * res))
    const lh = Math.max(1, Math.round((H + 2 * myd) * res))
    if (!this.layerTex || !this.layerFbo || lw !== this.layerW || lh !== this.layerH) {
      if (this.layerTex) gl.deleteTexture(this.layerTex)
      if (this.layerFbo) gl.deleteFramebuffer(this.layerFbo)
      gl.activeTexture(gl.TEXTURE4)
      this.layerTex = this.texture(gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.layerFbo = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.layerFbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.layerTex, 0)
      this.layerW = lw
      this.layerH = lh
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.layerFbo)
    gl.viewport(0, 0, lw, lh)
    gl.clear(gl.COLOR_BUFFER_BIT)
    // the layer's camera: the current one shifted by the margin, over a (w × h) CSS px view
    L.cx = f.cam.x
    L.cy = f.cam.y
    L.x = f.cam.x + mxd / sx
    L.y = f.cam.y + myd / sy
    L.k = f.cam.k
    L.w = (W + 2 * mxd) / sx
    L.h = (H + 2 * myd) / sy
    L.res = res
    this.layerUniforms(this.pEdge, f, sx * res)
    this.uf(this.pEdge, 'uWidth', f.linePx)
    this.uf(this.pEdge, 'uAlpha', 1)
    this.uf4(this.pEdge, 'uLine', f.line)
    gl.bindVertexArray(this.vaoEdges)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.m)
    if (f.arrowAlpha > 0) {
      this.layerUniforms(this.pArrow, f, sx * res)
      this.uf(this.pArrow, 'uSize', f.arrowSize)
      this.arrows(this.vaoEdges, scene.m, f.arrowAlpha, f.line)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, W, H)
    this.layerVer = this.edgeVer
    const P = this.layerParams
    P[0] = f.linePx
    P[1] = f.arrowAlpha
    P[2] = f.arrowSize
    P[3] = f.line[0]
    P[4] = f.line[1]
    P[5] = f.line[2]
    P[6] = f.line[3]
    P[7] = W
    P[8] = H
  }

  private layerUniforms(p: ProgInfo, f: FrameParams, dpr: number): void {
    const L = this.layerCam
    this.gl.useProgram(p.prog)
    this.uf(p, 'uCam', L.x, L.y, L.k)
    this.uf(p, 'uView', L.w, L.h)
    this.uf(p, 'uDpr', dpr)
    this.uf(p, 'uTime', f.time)
    this.uf(p, 'uMinR', f.minR)
  }

  private use(p: ProgInfo, f: FrameParams): void {
    const gl = this.gl
    gl.useProgram(p.prog)
    this.uf(p, 'uCam', f.cam.x, f.cam.y, f.cam.k)
    this.uf(p, 'uView', this.width, this.height)
    this.uf(p, 'uDpr', this.dpr)
    this.uf(p, 'uTime', f.time)
    this.uf(p, 'uMinR', f.minR)
  }

  /** float uniform (1–4 components by the number of arguments), skipped when unchanged */
  private uf(p: ProgInfo, name: string, a: number, b?: number, c?: number, d?: number): void {
    const loc = p.u[name]
    if (!loc) return
    // the first component starts as NaN, so a fresh cache never matches; missing components compare as 0
    const v = (p.c[name] ??= [NaN, 0, 0, 0])
    if (v[0] === a && v[1] === (b ?? 0) && v[2] === (c ?? 0) && v[3] === (d ?? 0)) return
    v[0] = a
    v[1] = b ?? 0
    v[2] = c ?? 0
    v[3] = d ?? 0
    const gl = this.gl
    if (d !== undefined) gl.uniform4f(loc, a, b!, c!, d)
    else if (c !== undefined) gl.uniform3f(loc, a, b!, c)
    else if (b !== undefined) gl.uniform2f(loc, a, b)
    else gl.uniform1f(loc, a)
  }

  private uf4(p: ProgInfo, name: string, v: ArrayLike<number>): void {
    this.uf(p, name, v[0], v[1], v[2], v[3])
  }

  private ui(p: ProgInfo, name: string, v: number): void {
    const loc = p.u[name]
    if (!loc || p.c[name]?.[0] === v) return
    ;(p.c[name] ??= [NaN])[0] = v
    this.gl.uniform1i(loc, v)
  }

  private uu(p: ProgInfo, name: string, v: number): void {
    const loc = p.u[name]
    if (!loc || p.c[name]?.[0] === v) return
    ;(p.c[name] ??= [NaN])[0] = v
    this.gl.uniform1ui(loc, v)
  }

  private arrows(vao: WebGLVertexArrayObject, count: number, alpha: number, color: Float32List): void {
    const gl = this.gl
    const p = this.pArrow
    this.uf(p, 'uAlpha', alpha)
    this.uf4(p, 'uLine', color)
    gl.bindVertexArray(vao)
    this.uu(p, 'uBit', 1)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, count)
    this.uu(p, 'uBit', 2)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, count)
  }

  private drawLabels(scene: Scene, f: FrameParams): boolean {
    const L = f.labels
    if (!L.count) return false
    const gl = this.gl
    const atlas = this.atlas
    atlas.setLuminance(0.2126 * f.text[0] + 0.7152 * f.text[1] + 0.0722 * f.text[2])
    if (atlas.fill > 0.92) atlas.clear()
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.texAtlas)
    const want = L.fontPx * this.dpr
    const size = Math.round(want * 2) / 2
    // while zooming, rasters of a nearby size are scaled instead of redone every frame; exact ones follow at rest
    const tolerance = f.zooming ? 0.2 : 0
    const t0 = performance.now()
    let more = false
    let count = 0
    // L is in priority order; fill back to front so the most important labels end up on top
    for (let j = Math.min(L.count, MAX_LABELS) - 1; j >= 0; j--) {
      const node: GNode = scene.nodes[L.idx[j]]
      let slot = node.lab as LabelSlot | null
      if (slot && (slot.gen !== atlas.gen || slot.font !== L.font)) slot = null
      if (!slot || Math.abs(slot.size / size - 1) > tolerance) {
        // rasterize within a per-frame budget; meanwhile reuse a raster of another size if there is one
        if (performance.now() - t0 < LABEL_BUDGET_MS) {
          const s = atlas.raster(gl, node.label, size, L.font, this.dpr)
          if (s) node.lab = slot = s
          else more = true
        } else more = true
        if (!slot) continue
      }
      const i = count++
      this.labelIdx[i] = node.index
      this.labelRect[i * 4] = slot.x
      this.labelRect[i * 4 + 1] = slot.y
      this.labelRect[i * 4 + 2] = slot.w
      this.labelRect[i * 4 + 3] = slot.h
      this.labelParam[i * 4] = L.alpha[j]
      this.labelParam[i * 4 + 1] = want / slot.size
      this.labelParam[i * 4 + 2] = slot.padX
      this.labelParam[i * 4 + 3] = slot.padY
    }
    if (!count) return more
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLabelIdx)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.labelIdx, 0, count)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLabelRect)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.labelRect, 0, count * 4)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLabelParam)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.labelParam, 0, count * 4)
    const pl = this.pLabel
    this.use(pl, f)
    this.uf(pl, 'uAtlas', atlas.w, atlas.h)
    this.uf4(pl, 'uText', f.text)
    this.uf4(pl, 'uHalo', f.bg)
    gl.bindVertexArray(this.vaoLabels)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
    return more
  }

  readPixel(scene: Scene, f: FrameParams, x: number, y: number): [number, number, number] {
    const gl = this.gl
    this.draw(scene, f)
    const H = Math.max(1, Math.round(this.height * this.dpr))
    const px = Math.round(x * this.dpr)
    const py = H - 1 - Math.round(y * this.dpr)
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel)
    const [r, g, b, a] = this.pixel
    if (!a) return [0, 0, 0]
    // the drawing buffer is premultiplied
    return [Math.round((r * 255) / a), Math.round((g * 255) / a), Math.round((b * 255) / a)]
  }

  finish(): void {
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.pixel)
  }

  destroy(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    this.onRestore = null
    // free the GPU memory now instead of whenever the canvas is collected (contexts are a limited resource)
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
