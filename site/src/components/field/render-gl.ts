/**
 * WebGL2 renderer: one instanced quad per capability. Each quad samples its sigil from the atlas and
 * adds an analytic halo and level rings, blended additively, so proof literally emits light.
 */
import { type Atlas, buildAtlas } from './atlas'
import type { FieldEngine } from './engine'

const VERT = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_pos;   // x, y (css px), size (px), atlas cell
layout(location=2) in vec4 a_color; // rgb, brightness
layout(location=3) in vec4 a_fx;    // glow, ring, hover, unused
uniform vec2 u_res;
uniform float u_cols;
out vec2 v_p;
out vec4 v_color;
out vec4 v_fx;
out vec2 v_cell;
const float HALO = 2.6;
void main() {
  vec2 px = a_pos.xy + a_corner * a_pos.z * 0.5 * HALO;
  vec2 clip = (px / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_p = a_corner * HALO;
  v_cell = vec2(mod(a_pos.w, u_cols), floor(a_pos.w / u_cols));
  v_color = a_color;
  v_fx = a_fx;
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 v_p;
in vec4 v_color;
in vec4 v_fx;
in vec2 v_cell;
uniform sampler2D u_atlas;
uniform vec2 u_cellUv;
out vec4 o;
void main() {
  vec2 p = v_p;
  float r = length(p);
  float g = 0.0;
  if (abs(p.x) < 1.0 && abs(p.y) < 1.0) {
    vec2 uv = (v_cell + (p * 0.5 + 0.5)) * u_cellUv;
    g = texture(u_atlas, uv).a;
  }
  float glow = v_fx.x;
  float halo = exp(-r * r * 1.15) * glow * 0.42 + exp(-r * r * 5.5) * glow * 0.5;
  float aa = fwidth(r) * 1.3;
  float ring = 0.0;
  if (v_fx.y > 0.5 && v_fx.y < 2.5) ring += smoothstep(aa, 0.0, abs(r - 1.12)) * 0.42;
  if (v_fx.y > 1.5 && v_fx.y < 2.5) ring += smoothstep(aa, 0.0, abs(r - 1.27)) * 0.42;
  if (v_fx.y > 2.5 && r < 1.2) ring += smoothstep(aa * 1.4, 0.0, abs(p.x + p.y) * 0.7071) * 0.9;
  ring += v_fx.z * smoothstep(aa * 1.5, 0.0, abs(r - 1.48)) * 0.85;
  vec3 c = v_color.rgb;
  float b = v_color.a;
  vec3 hot = vec3(1.0, 0.94, 0.84);
  vec3 col = c * (g * b + halo * b + ring * b) + hot * g * glow * 0.5 * b;
  o = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0));
}`

export class GLRenderer {
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private inst: WebGLBuffer
  private data: Float32Array
  private atlas: Atlas
  private tex: WebGLTexture
  private vao: WebGLVertexArrayObject
  private u: Record<string, WebGLUniformLocation | null>

  static create(canvas: HTMLCanvasElement, engine: FieldEngine): GLRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    })
    if (!gl) return null
    try {
      return new GLRenderer(gl, engine)
    } catch (e) {
      console.warn('sigil: WebGL2 unavailable, using Canvas2D', e)
      return null
    }
  }

  private constructor(gl: WebGL2RenderingContext, engine: FieldEngine) {
    this.gl = gl
    this.prog = program(gl, VERT, FRAG)
    this.u = Object.fromEntries(
      ['u_res', 'u_cols', 'u_atlas', 'u_cellUv'].map((n) => [
        n,
        gl.getUniformLocation(this.prog, n),
      ]),
    )
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.inst = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst)
    const stride = 12 * 4
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(1 + i)
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, stride, i * 16)
      gl.vertexAttribDivisor(1 + i, 1)
    }
    this.data = new Float32Array(Math.max(1, engine.nodes.length) * 12)
    this.atlas = buildAtlas(
      engine.nodes.map((n) => n.cap.digest),
      Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number),
    )
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  draw(engine: FieldEngine, dpr: number) {
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const d = this.data
    let n = 0
    for (let i = 0; i < engine.nodes.length; i++) {
      const node = engine.nodes[i]!
      const k = engine.intensity(node)
      if (k < 0.003) continue
      const o = n * 12
      d[o] = node.sx
      d[o + 1] = node.sy
      d[o + 2] = node.size
      d[o + 3] = i
      d[o + 4] = node.style.rgb[0]
      d[o + 5] = node.style.rgb[1]
      d[o + 6] = node.style.rgb[2]
      d[o + 7] = node.style.bright * k
      d[o + 8] = node.style.glow * (1 + node.hover * 0.6)
      d[o + 9] = node.style.ring
      d[o + 10] = node.hover
      d[o + 11] = 0
      n++
    }
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
    gl.useProgram(this.prog)
    gl.uniform2f(this.u.u_res!, canvas.width / dpr, canvas.height / dpr)
    gl.uniform1f(this.u.u_cols!, this.atlas.cols)
    gl.uniform2f(this.u.u_cellUv!, 1 / this.atlas.cols, 1 / this.atlas.rows)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.uniform1i(this.u.u_atlas!, 0)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst)
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, n * 12), gl.DYNAMIC_DRAW)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
  }

  dispose() {
    const gl = this.gl
    gl.deleteTexture(this.tex)
    gl.deleteBuffer(this.inst)
    gl.deleteProgram(this.prog)
    gl.deleteVertexArray(this.vao)
  }
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
    return s
  }
  const p = gl.createProgram()!
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
  return p
}
