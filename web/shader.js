/* WebGL 氛围背景：流动橙色色带 + 柔和噪点（近似原设计的 ChromaFlow/Swirl）
   全屏 quad + fragment shader，requestAnimationFrame 驱动 */
"use strict";

(function () {
  const canvas = document.getElementById("bg");
  if (!canvas) return;

  const gl = canvas.getContext("webgl", { antialias: true });
  if (!gl) {
    canvas.style.display = "none";
    return;
  }

  const VS = `
    attribute vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }
  `;

  const FS = `
    precision highp float;
    uniform vec2 u_res;
    uniform float u_time;
    uniform float u_dark;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 uv = gl_FragCoord.xy / u_res;
      float t = u_time * 0.12;
      // 底色：暗色主题暗紫底，浅色主题白到浅灰
      vec3 base = u_dark > 0.5
        ? mix(vec3(0.078, 0.058, 0.125), vec3(0.13, 0.10, 0.19), uv.y)
        : mix(vec3(0.965), vec3(0.92), uv.y);
      // 流动色带（暗色用紫色，浅色用橙色）
      float bands = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float y = uv.y * 2.6 + fi * 0.34 + sin(uv.x * 2.2 + t * 0.9 + fi * 2.1) * 0.28;
        float w = exp(-pow(fract(y) - 0.5, 2.0) * 14.0);
        bands += w * (0.22 + 0.10 * sin(t + fi));
      }
      vec3 purple = vec3(0.55, 0.33, 0.92);    // #8c54eb
      vec3 orange = vec3(1.0, 0.373, 0.012);   // #ff5f03
      vec3 flow = u_dark > 0.5 ? purple : orange;
      vec3 col = base + flow * bands * (u_dark > 0.5 ? 0.30 : 1.0);
      // 柔和噪点（FilmGrain 近似）
      float n = hash(uv * u_res / 3.0 + fract(t) * 17.0);
      col += (n - 0.5) * 0.018;
      // 右上角轻微氛围光（Swirl 感）
      float glow = exp(-distance(uv, vec2(0.82, 0.15)) * 2.6);
      col += flow * glow * (u_dark > 0.5 ? 0.08 : 0.10);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    canvas.style.display = "none";
    return;
  }
  gl.useProgram(prog);

  // 全屏 quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
  ]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uDark = gl.getUniformLocation(prog, "u_dark");

  function isDark() {
    return document.documentElement.dataset.theme === "dark";
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener("resize", resize);
  resize();

  const t0 = performance.now();
  function frame(now) {
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - t0) / 1000);
    gl.uniform1f(uDark, isDark() ? 1.0 : 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
