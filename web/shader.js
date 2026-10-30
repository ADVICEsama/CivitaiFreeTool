/* WebGL 氛围背景：流动色带 + 柔和噪点（ChromaFlow/Swirl 近似）
   底色取当前主题 --bg、流色取 --primary，主题切换实时跟随；
   暗色系（dark / dark_*）全部识别为暗色模式 */
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
    uniform vec3 u_bg_top;
    uniform vec3 u_bg_bottom;
    uniform vec3 u_flow;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 uv = gl_FragCoord.xy / u_res;
      float t = u_time * 0.12;
      // 底色：主题 --bg 自上而下轻微加深
      vec3 base = mix(u_bg_top, u_bg_bottom, uv.y);
      // 流动色带（流色 = 主题 --primary）
      float bands = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float y = uv.y * 2.6 + fi * 0.34 + sin(uv.x * 2.2 + t * 0.9 + fi * 2.1) * 0.28;
        float w = exp(-pow(fract(y) - 0.5, 2.0) * 14.0);
        bands += w * (0.22 + 0.10 * sin(t + fi));
      }
      vec3 flow = u_flow;
      vec3 col = base + flow * bands * (u_dark > 0.5 ? 0.30 : 0.45);
      // 柔和噪点（FilmGrain 近似）
      float n = hash(uv * u_res / 3.0 + fract(t) * 17.0);
      col += (n - 0.5) * 0.018;
      // 右上角轻微氛围光（Swirl 感）
      float glow = exp(-distance(uv, vec2(0.82, 0.15)) * 2.6);
      col += flow * glow * (u_dark > 0.5 ? 0.08 : 0.12);
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
  const uBgTop = gl.getUniformLocation(prog, "u_bg_top");
  const uBgBottom = gl.getUniformLocation(prog, "u_bg_bottom");
  const uFlow = gl.getUniformLocation(prog, "u_flow");

  // 仅终末地亮/暗模式。
  function isDark() {
    const t = document.documentElement.dataset.theme || "";
    return t === "dark_endfield";
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => x / 255);
  }

  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    const bg = hexToRgb(cs.getPropertyValue("--bg"));
    const pr = hexToRgb(cs.getPropertyValue("--primary"));
    return {
      bg: bg || [0.96, 0.96, 0.96],
      primary: pr || (isDark() ? [0.55, 0.33, 0.92] : [1.0, 0.373, 0.012]),
    };
  }

  function applyTheme() {
    const { bg, primary } = themeColors();
    const dark = isDark();
    // 底部微调：向下压一点形成细微渐变（暗色压向更暗，浅色压向浅灰）
    const bottom = dark
      ? [bg[0] * 0.86, bg[1] * 0.86, bg[2] * 0.86]
      : [bg[0] * 0.95, bg[1] * 0.95, bg[2] * 0.95];
    gl.uniform3f(uBgTop, bg[0], bg[1], bg[2]);
    gl.uniform3f(uBgBottom, bottom[0], bottom[1], bottom[2]);
    gl.uniform3f(uFlow, primary[0], primary[1], primary[2]);
    gl.uniform1f(uDark, dark ? 1.0 : 0.0);
  }
  applyTheme();

  // 测试钩子：供自动化验证（dark 标志 + 当前底色/流色）
  window.__bgInfo = function () {
    const { bg, primary } = themeColors();
    return { dark: isDark(), bg: bg, primary: primary };
  };

  // 主题切换（data-theme 属性变化）时实时更新背景色
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style"],
  });

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  window.addEventListener("resize", resize);
  resize();

  let rafId = 0, lastDraw = 0, running=false;
  function draw(ts) {
    rafId=0;if(!running)return;
    const cap=window.CFTMotion?.effectiveFps(Number(window.cftEffectsFpsLimit ?? 60))??Number(window.cftEffectsFpsLimit ?? 60);
    if(!cap||ts-lastDraw>=1000/cap-.5){lastDraw=ts;gl.uniform1f(uTime,ts*.001);gl.uniform2f(uRes,canvas.width,canvas.height);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
    rafId=requestAnimationFrame(draw);
  }
  function syncLoop(){running=!document.hidden&&!window.CFTMotion?.reduced()&&!window.CFTMotion?.paused()&&canvas.offsetParent!==null&&getComputedStyle(canvas).display!=='none'&&!document.getElementById('imageViewer');if(!running&&rafId){cancelAnimationFrame(rafId);rafId=0;}if(running&&!rafId)rafId=requestAnimationFrame(draw);canvas.dataset.loopRunning=String(running);}
  window.addEventListener('cft:activity-changed',syncLoop);document.addEventListener('visibilitychange',syncLoop);window.addEventListener('cft:window-moving',syncLoop);window.addEventListener('cft:config-saved',syncLoop);window.addEventListener('cft:page-changed',syncLoop);
  new MutationObserver(syncLoop).observe(canvas,{attributes:true,attributeFilter:['style']});
  new MutationObserver(syncLoop).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-ui-animations']});
  new MutationObserver(syncLoop).observe(document.body,{attributes:true,attributeFilter:['class'],childList:true});syncLoop();
})();
