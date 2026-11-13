// Vanilla JavaScript version of the CloudShader component (WebGL).

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Each cloud is an asymmetric envelope (dome top, flat base) filled with
// domain-warped billow noise. A second density sample above the pixel
// approximates self-shadowing. Clouds drift horizontally and wrap around.
const FRAG = `
precision highp float;

varying vec2 v_uv;

uniform vec2 u_res;
uniform float u_time;
uniform float u_count;
uniform vec3 u_cloud;
uniform vec3 u_skyTop;
uniform vec3 u_skyBottom;

const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.31, 289.17))) * 26737.367);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    p = R * p * 2.03 + 19.19;
    amp *= 0.5;
  }
  return sum;
}

// billow noise: sharp puffy ridges, like cauliflower cloud tops
float billow(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * (1.0 - abs(2.0 * vnoise(p) - 1.0));
    p = R * p * 2.11 + 13.37;
    amp *= 0.5;
  }
  return sum;
}

// raw density for one cloud at point p
float cloudDensity(vec2 p, vec2 c, vec2 r, float seed, float t) {
  vec2 q = p - c;

  // envelope: dome above the center, flat base below
  float ry = q.y > 0.0 ? r.y : r.y * 0.42;
  float env = 1.0 - length(vec2(q.x / r.x, q.y / ry));
  if (env < -0.35) return 0.0;

  // domain-warped billow detail, moves with the cloud, evolves slowly
  vec2 dp = q * (2.4 / r.x) + seed;
  dp += 0.6 * vec2(
    fbm(dp * 1.4 + t * 0.04),
    fbm(dp * 1.4 + 7.7 - t * 0.03)
  );
  float detail = billow(dp * 1.6);

  return env + (detail - 0.62) * 0.62;
}

// shades one cloud and blends it over the current color
vec3 shadeCloud(vec3 color, vec3 sky, vec2 p, vec2 c, vec2 r, float seed, float t, float dist) {
  float d = cloudDensity(p, c, r, seed, t);
  if (d < 0.02) return color;

  // sample density toward the sun (straight up) for self-shadowing
  float dUp = cloudDensity(p + vec2(0.0, r.y * 0.55), c, r, seed, t);
  float occl = clamp((dUp - d) * 1.1 + d * 0.55, 0.0, 1.0);

  vec3 lit = u_cloud * 1.04;
  vec3 shadow = mix(u_cloud * 0.60, sky, 0.38);
  vec3 cloudCol = mix(lit, shadow, occl * 0.85);

  float alpha = smoothstep(0.02, 0.38, d);

  // silver lining on thin edges
  float rim = smoothstep(0.02, 0.14, d) * (1.0 - smoothstep(0.14, 0.40, d));
  cloudCol += rim * 0.10;

  // atmospheric perspective: far clouds fade into the sky
  cloudCol = mix(cloudCol, sky, dist * 0.35);
  alpha *= mix(1.0, 0.8, dist);

  return mix(color, cloudCol, alpha);
}

// one drifting cloud: horizontal wrap + gentle vertical bob
vec3 cloudPass(vec3 color, vec3 sky, vec2 p, float aspect, float t,
               float spd, float phase, float y, vec2 r, float seed, float dist) {
  float cx = mix(-r.x - 0.25, aspect + r.x + 0.25, fract(t * spd + phase));
  float cy = y + sin(t * 0.05 + phase * 6.2831) * 0.012;
  return shadeCloud(color, sky, p, vec2(cx, cy), r, seed, t, dist);
}

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  float t = u_time;

  vec3 sky = mix(u_skyBottom, u_skyTop, v_uv.y);
  vec3 color = sky;

  // faint haze band near the horizon
  color = mix(color, u_skyBottom * 1.06, smoothstep(0.35, 0.0, v_uv.y) * 0.5);

  // soft sun glow, upper area
  vec2 sunPos = vec2(aspect * 0.78, 0.92);
  float sunDist = length(p - sunPos);
  color += vec3(1.0, 0.95, 0.82) * exp(-sunDist * sunDist * 5.0) * 0.28;

  // thin cirrus streaks, stretched horizontally, high in the sky
  float cirrusBand = smoothstep(0.55, 0.8, v_uv.y) * (1.0 - smoothstep(0.9, 1.0, v_uv.y));
  if (cirrusBand > 0.01) {
    float streak = fbm(vec2(p.x * 1.6 - t * 0.006, p.y * 12.0));
    float wisp = smoothstep(0.52, 0.78, streak) * cirrusBand;
    color = mix(color, u_cloud * 0.98, wisp * 0.35);
  }

  // far layer: small, high, slow
  if (u_count > 5.5) {
    color = cloudPass(color, sky, p, aspect, t, 0.006, 0.10, 0.84, vec2(0.20, 0.10), 43.7, 1.0);
  }
  if (u_count > 4.5) {
    color = cloudPass(color, sky, p, aspect, t, 0.008, 0.62, 0.73, vec2(0.24, 0.12), 71.3, 0.85);
  }

  // middle layer
  if (u_count > 3.5) {
    color = cloudPass(color, sky, p, aspect, t, 0.011, 0.33, 0.60, vec2(0.34, 0.16), 17.3, 0.55);
  }
  if (u_count > 2.5) {
    color = cloudPass(color, sky, p, aspect, t, 0.013, 0.80, 0.47, vec2(0.30, 0.15), 29.9, 0.45);
  }

  // near layer: big, low, fast
  if (u_count > 1.5) {
    color = cloudPass(color, sky, p, aspect, t, 0.016, 0.05, 0.35, vec2(0.46, 0.20), 91.1, 0.15);
  }
  color = cloudPass(color, sky, p, aspect, t, 0.020, 0.48, 0.20, vec2(0.56, 0.24), 57.2, 0.0);

  gl_FragColor = vec4(color, 1.0);
}
`;

function parseHex(color) {
  const value = color.trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
      ];
    }
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  const rgb = value.match(/[\d.]+/g);
  if (rgb && rgb.length >= 3) {
    return [Number(rgb[0]) / 255, Number(rgb[1]) / 255, Number(rgb[2]) / 255];
  }
  return [0.95, 0.95, 0.95];
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Mounts the cloud shader into a container element.
 * Options: speed (1), count (1-6, default 6), cloudColor, skyTopColor, skyBottomColor.
 * Returns a function that stops the animation and frees GPU resources.
 */
function createCloudShader(container, options = {}) {
  const {
    speed = 1,
    count = 6,
    cloudColor = "#fbf8f2",
    skyTopColor = "#3876ba",
    skyBottomColor = "#8cbfe8",
  } = options;

  const canvas = document.createElement("canvas");
  container.appendChild(canvas);

  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) return () => {};

  const vert = compile(gl, gl.VERTEX_SHADER, VERT);
  const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vert || !frag) return () => {};

  const program = gl.createProgram();
  if (!program) return () => {};
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.bindAttribLocation(program, 0, "a_pos");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return () => {};
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const loc = {
    res: gl.getUniformLocation(program, "u_res"),
    time: gl.getUniformLocation(program, "u_time"),
    count: gl.getUniformLocation(program, "u_count"),
    cloud: gl.getUniformLocation(program, "u_cloud"),
    skyTop: gl.getUniformLocation(program, "u_skyTop"),
    skyBottom: gl.getUniformLocation(program, "u_skyBottom"),
  };

  let frame = 0;
  let running = true;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(loc.res, w, h);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const cloud = parseHex(cloudColor);
  const skyTop = parseHex(skyTopColor);
  const skyBottom = parseHex(skyBottomColor);

  const start = performance.now();
  const draw = (now) => {
    if (!running) return;
    const elapsed = reduceMotion ? 0 : ((now - start) / 1000) * speed;

    gl.uniform1f(loc.time, elapsed);
    gl.uniform1f(loc.count, Math.min(6, Math.max(1, count)));
    gl.uniform3f(loc.cloud, cloud[0], cloud[1], cloud[2]);
    gl.uniform3f(loc.skyTop, skyTop[0], skyTop[1], skyTop[2]);
    gl.uniform3f(loc.skyBottom, skyBottom[0], skyBottom[1], skyBottom[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  return () => {
    running = false;
    cancelAnimationFrame(frame);
    observer.disconnect();
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    canvas.remove();
  };
}


// =====================================================================
// SITE
// =====================================================================
// ---------------------------------------------------------------------------
// 1. PRODUCTS — edit this list with your real catalog.
//    price = current price, was = original price (makes it a Sale item),
//    isNew = shows on New Arrivals, best = "Best seller" badge,
//    image = photo URL (leave "" for a gradient placeholder tile).
// ---------------------------------------------------------------------------
const PRODUCTS = [
  { id: 1, name: "Wireless Headphones", category: "Electronics", price: 129, image: "", tone: ["#5aa0de", "#2f66a3"], best: true },
  { id: 2, name: "Smart Watch", category: "Electronics", price: 199, was: 249, image: "", tone: ["#4a86c8", "#274f80"] },
  { id: 3, name: "Portable Speaker", category: "Electronics", price: 79, isNew: true, image: "", tone: ["#f0a868", "#d9773a"] },
  { id: 4, name: "Everyday Backpack", category: "Fashion", price: 89, was: 109, image: "", tone: ["#9b7b63", "#6b4f3c"] },
  { id: 5, name: "Classic Sneakers", category: "Fashion", price: 109, was: 139, best: true, image: "", tone: ["#8aa0b8", "#566b83"] },
  { id: 6, name: "Linen Overshirt", category: "Fashion", price: 69, was: 89, image: "", tone: ["#86a784", "#557553"] },
  { id: 7, name: "Ceramic Mug Set", category: "Home", price: 34, was: 44, image: "", tone: ["#e8a094", "#c46f62"] },
  { id: 8, name: "Soft Throw Blanket", category: "Home", price: 59, isNew: true, image: "", tone: ["#cdb08a", "#a07f55"] },
  { id: 9, name: "Desk Lamp", category: "Home", price: 49, image: "", tone: ["#e8c85a", "#c49a22"] },
  { id: 10, name: "Leather Wallet", category: "Accessories", price: 45, image: "", tone: ["#8a6048", "#5a3b28"] },
  { id: 11, name: "Sunglasses", category: "Accessories", price: 75, was: 95, image: "", tone: ["#4a6a8f", "#2b4262"] },
  { id: 12, name: "Canvas Tote Bag", category: "Accessories", price: 29, image: "", tone: ["#9fb7cf", "#6d8caa"] },
  { id: 13, name: "Mechanical Keyboard", category: "Electronics", price: 99, isNew: true, image: "", tone: ["#7a8aa3", "#4c5b73"] },
  { id: 14, name: "Merino Beanie", category: "Fashion", price: 24, isNew: true, image: "", tone: ["#cf7f72", "#a24f43"] },
  { id: 15, name: "Scented Candle", category: "Home", price: 19, isNew: true, image: "", tone: ["#e6b07a", "#c7803f"] },
  { id: 16, name: "Phone Case", category: "Accessories", price: 22, isNew: true, image: "", tone: ["#6dbdad", "#3d8c7c"] },
];

const COLLECTIONS = [
  { name: "Electronics", blurb: "Headphones, watches, speakers and more.", tone: ["#e8f1fb", "#3876ba"] },
  { name: "Fashion", blurb: "Everyday wear and essentials.", tone: ["#f3ece4", "#8a6f5a"] },
  { name: "Home", blurb: "Small things that make home feel better.", tone: ["#fdf0ee", "#e29a8f"] },
  { name: "Accessories", blurb: "Finishing touches for every day.", tone: ["#efe4da", "#6b4a35"] },
];

// ---------------------------------------------------------------------------
// PRODUCT PHOTOS
// These are free-to-use stock photos from Pexels (pexels.com, no credit required):
// real photos of each TYPE of item, used as samples. They are NOT photos of your
// own stock, so replace each link with your own photo when you have it.
// Leave "" to show the drawn illustration instead. If a link is broken, the
// illustration is shown automatically.
// ---------------------------------------------------------------------------
const PHOTOS = {
  1: "https://images.pexels.com/photos/3394665/pexels-photo-3394665.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Wireless Headphones
  2: "https://images.pexels.com/photos/267394/pexels-photo-267394.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Smart Watch
  3: "https://images.pexels.com/photos/6023354/pexels-photo-6023354.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Portable Speaker
  4: "https://images.pexels.com/photos/13693319/pexels-photo-13693319.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Everyday Backpack
  5: "https://images.pexels.com/photos/9660927/pexels-photo-9660927.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Classic Sneakers
  6: "https://images.pexels.com/photos/5120085/pexels-photo-5120085.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Linen Overshirt
  7: "https://images.pexels.com/photos/6312177/pexels-photo-6312177.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Ceramic Mug Set
  8: "https://images.pexels.com/photos/10373508/pexels-photo-10373508.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Soft Throw Blanket
  9: "https://images.pexels.com/photos/1112598/pexels-photo-1112598.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Desk Lamp
  10: "https://images.pexels.com/photos/915917/pexels-photo-915917.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Leather Wallet
  11: "https://images.pexels.com/photos/1705391/pexels-photo-1705391.png?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Sunglasses
  12: "https://images.pexels.com/photos/1214212/pexels-photo-1214212.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Canvas Tote Bag
  13: "https://images.pexels.com/photos/7915211/pexels-photo-7915211.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Mechanical Keyboard
  14: "https://images.pexels.com/photos/2460527/pexels-photo-2460527.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Merino Beanie
  15: "https://images.pexels.com/photos/12336392/pexels-photo-12336392.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Scented Candle
  16: "https://images.pexels.com/photos/7742552/pexels-photo-7742552.jpeg?auto=compress&cs=tinysrgb&w=700&h=700&fit=crop", // Phone Case
};
PRODUCTS.forEach((p) => {
  if (PHOTOS[p.id]) p.image = PHOTOS[p.id];
});

const CATEGORIES = ["All", ...new Set(PRODUCTS.map((p) => p.category))];
const NAV_LINKS = [["shop", "Shop"], ["new", "New Arrivals"], ["sale", "Sale"], ["support", "Support"]];
const VIEWS = ["home", "shop", "new", "sale", "collections", "support", "signin"];
const CART_KEY = "nimbus-cart";
const USER_KEY = "nimbus-user";

// ---------------------------------------------------------------------------
// 2. STATE + HELPERS
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function readStore(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — it just won't persist */
  }
}

const state = {
  view: "home",
  category: "All",
  sort: "featured",
  query: "",
  authMode: "signin",
  cart: readStore(CART_KEY, {}), // { [productId]: quantity }
  user: readStore(USER_KEY, null), // { name, email }
};

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const productById = (id) => PRODUCTS.find((p) => p.id === Number(id));
const percentOff = (p) => (p.was ? Math.round((1 - p.price / p.was) * 100) : 0);
const cartCount = () => Object.values(state.cart).reduce((s, q) => s + q, 0);
const cartSubtotal = () =>
  Object.entries(state.cart).reduce((sum, [id, qty]) => {
    const p = productById(id);
    return p ? sum + p.price * qty : sum;
  }, 0);

// ---------------------------------------------------------------------------
// PRODUCT ILLUSTRATIONS — one original drawing per product id.
// To use a real photo instead, set `image: "https://..."` on that product.
// ---------------------------------------------------------------------------
const ART = {
  1: (a) => `<path d="M46 124C46 62 154 62 154 124" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/><rect x="34" y="104" width="30" height="50" rx="14" fill="#fff"/><rect x="42" y="116" width="14" height="26" rx="7" fill="${a}"/><rect x="136" y="104" width="30" height="50" rx="14" fill="#fff"/><rect x="144" y="116" width="14" height="26" rx="7" fill="${a}"/>`,
  2: (a) => `<rect x="78" y="26" width="44" height="46" rx="10" fill="#fff" opacity=".85"/><rect x="78" y="128" width="44" height="46" rx="10" fill="#fff" opacity=".85"/><rect x="60" y="60" width="80" height="80" rx="22" fill="#fff"/><rect x="69" y="69" width="62" height="62" rx="15" fill="${a}"/><path d="M100 84V101L112 108" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><rect x="140" y="88" width="8" height="18" rx="3" fill="#fff"/>`,
  3: (a) => `<path d="M70 62C70 34 130 34 130 62" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/><rect x="48" y="58" width="104" height="96" rx="24" fill="#fff"/><circle cx="100" cy="116" r="30" fill="${a}"/><circle cx="100" cy="116" r="12" fill="#fff"/><circle cx="100" cy="80" r="7" fill="${a}"/>`,
  4: (a) => `<path d="M86 60C86 38 114 38 114 60" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/><rect x="44" y="96" width="12" height="40" rx="6" fill="#fff" opacity=".8"/><rect x="144" y="96" width="12" height="40" rx="6" fill="#fff" opacity=".8"/><rect x="56" y="54" width="88" height="104" rx="30" fill="#fff"/><rect x="72" y="112" width="56" height="34" rx="12" fill="${a}"/><path d="M72 98H128" stroke="${a}" stroke-width="4" stroke-linecap="round"/>`,
  5: (a) => `<g transform="translate(0 16)"><path d="M30 132V106Q30 96 40 96H72Q80 96 86 88L98 74Q104 68 112 74L124 94Q134 104 156 110Q174 114 174 132Z" fill="#fff"/><rect x="26" y="130" width="152" height="16" rx="8" fill="${a}"/><path d="M96 88L108 98M104 80L116 90M90 96L100 104" stroke="${a}" stroke-width="4" stroke-linecap="round"/><path d="M148 114Q164 118 168 128" fill="none" stroke="${a}" stroke-width="4" stroke-linecap="round"/></g>`,
  6: (a) => `<path d="M70 42L48 56L26 94L48 106L58 92V158H142V92L152 106L174 94L152 56L130 42L100 62Z" fill="#fff"/><path d="M70 42L100 80L130 42" fill="none" stroke="${a}" stroke-width="6" stroke-linejoin="round"/><path d="M100 80V158" stroke="${a}" stroke-width="3"/><circle cx="108" cy="102" r="3" fill="${a}"/><circle cx="108" cy="124" r="3" fill="${a}"/><circle cx="108" cy="146" r="3" fill="${a}"/><rect x="68" y="104" width="22" height="22" rx="4" fill="none" stroke="${a}" stroke-width="3"/>`,
  7: (a) => `<g transform="translate(0 8)"><rect x="34" y="82" width="58" height="68" rx="12" fill="#fff"/><path d="M34 96C12 96 12 130 34 130" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/><rect x="34" y="100" width="58" height="10" fill="${a}"/><rect x="108" y="102" width="50" height="50" rx="11" fill="#fff" opacity=".92"/><path d="M158 112C178 112 178 142 158 142" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".92"/><rect x="108" y="118" width="50" height="9" fill="${a}"/></g>`,
  8: (a) => `<rect x="40" y="64" width="120" height="26" rx="12" fill="#fff" opacity=".7"/><rect x="34" y="88" width="132" height="26" rx="12" fill="#fff"/><rect x="40" y="112" width="120" height="26" rx="12" fill="${a}"/><rect x="34" y="136" width="132" height="26" rx="12" fill="#fff"/><path d="M52 101H148M52 149H148" stroke="${a}" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`,
  9: (a) => `<ellipse cx="100" cy="158" rx="36" ry="8" fill="#fff"/><path d="M100 152V112L128 70" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="100" cy="112" r="7" fill="${a}"/><path transform="translate(130 62) rotate(-28)" d="M-22 -6H22L34 24H-34Z" fill="#fff"/><circle cx="141" cy="92" r="9" fill="#ffe9a0"/>`,
  10: (a) => `<rect x="58" y="52" width="52" height="30" rx="6" fill="${a}" opacity=".7"/><rect x="36" y="66" width="128" height="88" rx="16" fill="#fff"/><rect x="46" y="76" width="108" height="68" rx="10" fill="none" stroke="${a}" stroke-width="3" stroke-dasharray="5 5"/><rect x="122" y="98" width="42" height="24" rx="12" fill="${a}"/><circle cx="136" cy="110" r="4" fill="#fff"/>`,
  11: (a) => `<g transform="translate(0 10)"><path d="M84 98Q100 88 116 98" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M30 92L14 84M170 92L186 84" stroke="#fff" stroke-width="7" stroke-linecap="round"/><rect x="28" y="84" width="58" height="46" rx="20" fill="rgba(15,42,67,.75)" stroke="#fff" stroke-width="7"/><rect x="114" y="84" width="58" height="46" rx="20" fill="rgba(15,42,67,.75)" stroke="#fff" stroke-width="7"/><path d="M42 98H56M128 98H142" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".6"/></g>`,
  12: (a) => `<path d="M72 70C72 32 128 32 128 70" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/><path d="M50 68H150L158 162H42Z" fill="#fff"/><circle cx="100" cy="112" r="17" fill="${a}"/><path d="M92 112L98 118L110 104" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  13: (a) => `<g transform="translate(0 4)"><rect x="24" y="74" width="152" height="82" rx="12" fill="#fff"/>${[0,1,2,3,4,5,6,7].map((i) => `<rect x="${34 + 17 * i}" y="84" width="14" height="14" rx="3" fill="${a}"/>`).join("")}${[0,1,2,3,4,5,6].map((i) => `<rect x="${42 + 17 * i}" y="102" width="14" height="14" rx="3" fill="${a}"/>`).join("")}<rect x="34" y="120" width="18" height="14" rx="3" fill="${a}"/><rect x="56" y="120" width="70" height="14" rx="3" fill="${a}"/><rect x="130" y="120" width="14" height="14" rx="3" fill="${a}"/><rect x="148" y="120" width="18" height="14" rx="3" fill="${a}"/></g>`,
  14: (a) => `<g transform="translate(0 6)"><circle cx="100" cy="62" r="15" fill="#fff" opacity=".9"/><path d="M46 126C46 76 154 76 154 126Z" fill="#fff"/><rect x="38" y="118" width="124" height="34" rx="14" fill="${a}"/><path d="M58 122V148M74 122V148M90 122V148M106 122V148M122 122V148M138 122V148" stroke="#fff" stroke-width="3" opacity=".5" stroke-linecap="round"/></g>`,
  15: (a) => `<circle cx="100" cy="56" r="24" fill="#ffe08a" opacity=".3"/><path d="M100 36C112 52 110 64 100 66C90 64 88 52 100 36Z" fill="#ffd36b"/><path d="M100 66V82" stroke="${a}" stroke-width="3" stroke-linecap="round"/><rect x="60" y="82" width="80" height="76" rx="16" fill="#fff"/><rect x="72" y="108" width="56" height="30" rx="8" fill="${a}"/><path d="M84 123H116" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  16: (a) => `<g transform="translate(0 -4)"><rect x="62" y="30" width="76" height="138" rx="18" fill="#fff"/><rect x="70" y="38" width="32" height="32" rx="9" fill="${a}"/><circle cx="80" cy="48" r="6" fill="#fff"/><circle cx="92" cy="60" r="6" fill="#fff"/><rect x="72" y="150" width="56" height="6" rx="3" fill="${a}" opacity=".4"/></g>`,
};

function productArtSvg(p) {
  const draw = ART[p.id];
  const inner = draw ? draw(p.tone[1]) : "";
  return `<svg viewBox="0 0 200 200" style="width:78%;height:78%" aria-hidden="true"><ellipse cx="100" cy="170" rx="52" ry="7" fill="rgba(15,42,67,.2)"/>${inner}</svg>`;
}

// The drawn illustration (used when there is no photo, or the photo fails to load).
function artHtml(p) {
  return `<div class="thumb" role="img" aria-label="${esc(p.name)}"
      style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:linear-gradient(135deg, ${p.tone[0]}, ${p.tone[1]})">${productArtSvg(p)}</div>`;
}

// Product picture: the real photo if one is set, otherwise the illustration.
function thumbHtml(p) {
  if (p.image) {
    return `<img src="${esc(p.image)}" alt="${esc(p.name)}" data-id="${p.id}" loading="lazy"
      onerror="photoFailed(this)" class="thumb" style="width:100%;height:100%;object-fit:cover;display:block" />`;
  }
  return artHtml(p);
}

function photoFailed(img) {
  const p = productById(img.dataset.id);
  if (p) img.outerHTML = artHtml(p);
}

let toastTimer;
function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

// ---------------------------------------------------------------------------
// 3. SHARED NAVBAR (one template, rendered into every page)
// ---------------------------------------------------------------------------
function navHtml(active) {
  const link = ([v, label], extra = "") =>
    `<a href="#${v}" data-nav="${v}" class="transition hover:text-white ${extra} ${active === v ? "text-white underline underline-offset-8" : ""}">${label}</a>`;
  const desktop = NAV_LINKS.map((l) => link(l)).join("");
  const mobile = NAV_LINKS.map((l) =>
    link(l, "shrink-0 rounded-full border border-white/30 px-3 py-1.5 text-xs font-medium text-white/90"),
  ).join("");
  const firstName = state.user ? esc(state.user.name.split(" ")[0]) : "";

  return `
    <nav class="relative z-30 mx-auto flex w-full max-w-7xl items-center justify-between px-4 pt-6 md:px-8">
      <div class="flex items-center gap-10">
        <a href="#home" data-nav="home" class="text-lg font-semibold tracking-tight text-white">Nimbus</a>
        <div class="hidden items-center gap-8 text-sm font-medium text-white/90 md:flex">${desktop}</div>
      </div>
      <div class="flex items-center gap-3">
        <button type="button" data-cart-open aria-label="Open cart"
          class="flex items-center gap-2 rounded-full border border-white/40 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-white/10">
          Cart
          <span class="cart-count flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-[#3876ba]">0</span>
        </button>
        <a href="#signin" data-nav="signin"
          class="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-white/90">
          ${state.user ? `Hi, ${firstName}` : "Sign in"}
        </a>
      </div>
    </nav>
    <div class="relative z-30 mx-auto flex w-full max-w-7xl gap-2 overflow-x-auto px-4 pt-4 md:hidden">${mobile}</div>`;
}

function renderNavs() {
  document.querySelectorAll("[data-nav-slot]").forEach((slot) => {
    slot.innerHTML = navHtml(slot.dataset.navSlot);
  });
  updateCartBadge();
}

function updateCartBadge(pop = false) {
  document.querySelectorAll(".cart-count").forEach((el) => {
    el.textContent = cartCount();
    if (pop) {
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("pop");
    }
  });
}

// ---------------------------------------------------------------------------
// 4. PRODUCT CARDS + PAGES
// ---------------------------------------------------------------------------
function badgeFor(p) {
  if (p.was) return `-${percentOff(p)}%`;
  if (p.isNew) return "New";
  if (p.best) return "Best seller";
  return "";
}

function cardHtml(p, i) {
  const badge = badgeFor(p);
  return `
    <article class="product-card flex flex-col overflow-hidden rounded-3xl bg-white text-black" style="animation-delay:${i * 60}ms">
      <div class="relative aspect-square overflow-hidden">
        ${thumbHtml(p)}
        ${badge ? `<span class="absolute top-3 left-3 rounded-full bg-white px-3 py-1 text-xs font-semibold text-black shadow">${badge}</span>` : ""}
      </div>
      <div class="flex flex-1 flex-col p-5">
        <p class="text-xs font-medium tracking-wide text-black/50 uppercase">${esc(p.category)}</p>
        <h3 class="mt-1 text-base font-semibold">${esc(p.name)}</h3>
        <div class="mt-auto flex items-center justify-between pt-4">
          <span class="flex items-baseline gap-2">
            <span class="text-lg font-bold">${money.format(p.price)}</span>
            ${p.was ? `<span class="text-sm text-black/40 line-through">${money.format(p.was)}</span>` : ""}
          </span>
          <button type="button" data-add="${p.id}"
            class="rounded-full bg-[#3876ba] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2f66a3] active:scale-95">Add to cart</button>
        </div>
      </div>
    </article>`;
}

const countText = (n) => `${n} product${n === 1 ? "" : "s"}`;

// ----- Shop (filters)
function renderChips() {
  $("category-chips").innerHTML = CATEGORIES.map((cat) => {
    const active = cat === state.category;
    return `<button type="button" data-category="${cat}"
      class="rounded-full border px-4 py-2 text-sm font-semibold transition ${
        active ? "border-white bg-white text-black" : "border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/20"
      }">${cat}</button>`;
  }).join("");
}

function visibleProducts() {
  const q = state.query.trim().toLowerCase();
  let list = PRODUCTS.filter(
    (p) =>
      (state.category === "All" || p.category === state.category) &&
      (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)),
  );
  if (state.sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
  if (state.sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
  if (state.sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function renderShop() {
  renderChips();
  $("search").value = state.query;
  $("sort").value = state.sort;
  const list = visibleProducts();
  $("result-count").textContent = countText(list.length);
  $("empty-state").classList.toggle("hidden", list.length > 0);
  $("product-grid").innerHTML = list.map(cardHtml).join("");
}

// ----- New arrivals / Sale
function renderNew() {
  const list = PRODUCTS.filter((p) => p.isNew);
  $("new-count").textContent = countText(list.length);
  $("new-grid").innerHTML = list.map(cardHtml).join("");
}

function renderSale() {
  const list = PRODUCTS.filter((p) => p.was).sort((a, b) => percentOff(b) - percentOff(a));
  const best = list.length ? Math.max(...list.map(percentOff)) : 0;
  $("sale-banner").textContent = `Up to ${best}% off`;
  $("sale-count").textContent = countText(list.length);
  $("sale-grid").innerHTML = list.map(cardHtml).join("");
}

// ----- Collections
function renderCollections() {
  $("collections-grid").innerHTML = COLLECTIONS.map((c, i) => {
    const count = PRODUCTS.filter((p) => p.category === c.name).length;
    return `
    <article class="product-card group flex flex-col overflow-hidden rounded-3xl bg-white text-black" style="animation-delay:${i * 80}ms">
      <div class="grid h-52 grid-cols-2 grid-rows-2 overflow-hidden">
        ${PRODUCTS.filter((p) => p.category === c.name).slice(0, 4).map((p) => `<div class="overflow-hidden">${thumbHtml(p)}</div>`).join("")}
      </div>
      <div class="flex flex-1 flex-col p-6">
        <div class="flex items-baseline justify-between">
          <h3 class="text-xl font-bold">${c.name}</h3>
          <span class="text-sm text-black/50">${countText(count)}</span>
        </div>
        <p class="mt-1 text-sm text-black/70">${c.blurb}</p>
        <button type="button" data-collection="${c.name}"
          class="mt-5 self-start rounded-full bg-[#3876ba] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2f66a3] active:scale-95">Explore ${c.name}</button>
      </div>
    </article>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// 5. SIGN IN / CREATE ACCOUNT (demo — no server)
// ---------------------------------------------------------------------------
const FIELD =
  "w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm text-black outline-none transition focus:border-[#3876ba] focus:ring-2 focus:ring-[#3876ba]/30";

function renderAuth() {
  const card = $("auth-card");

  if (state.user) {
    card.innerHTML = `
      <h2 class="text-2xl font-bold">You're signed in</h2>
      <p class="mt-2 text-sm text-black/70">Signed in as <span class="font-semibold">${esc(state.user.email)}</span></p>
      <button type="button" data-nav="shop" class="mt-6 w-full rounded-full bg-[#3876ba] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2f66a3]">Continue shopping</button>
      <button type="button" data-signout class="mt-3 w-full rounded-full border border-black/15 px-6 py-3 text-sm font-semibold transition hover:bg-black/5">Sign out</button>`;
    return;
  }

  const signup = state.authMode === "signup";
  card.innerHTML = `
    <h2 class="text-2xl font-bold">${signup ? "Create your account" : "Welcome back"}</h2>
    <p class="mt-1 text-sm text-black/70">${signup ? "Join to save your details for faster checkout." : "Sign in to your Nimbus account."}</p>
    <form data-form="auth" novalidate class="mt-6 flex flex-col gap-4">
      ${signup ? `<input name="name" type="text" placeholder="Full name" aria-label="Full name" autocomplete="name" class="${FIELD}" />` : ""}
      <input name="email" type="email" placeholder="Email address" aria-label="Email address" autocomplete="email" class="${FIELD}" />
      <input name="password" type="password" placeholder="Password" aria-label="Password" autocomplete="${signup ? "new-password" : "current-password"}" class="${FIELD}" />
      <p data-error hidden class="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700"></p>
      <button type="submit" class="rounded-full bg-[#3876ba] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2f66a3]">${signup ? "Create account" : "Sign in"}</button>
    </form>
    <p class="mt-5 text-center text-sm text-black/70">
      ${signup ? "Already have an account?" : "New to Nimbus?"}
      <button type="button" data-auth-mode="${signup ? "signin" : "signup"}" class="font-semibold text-[#3876ba] hover:underline">${signup ? "Sign in" : "Create an account"}</button>
    </p>
    <p class="mt-4 text-center text-xs text-black/50">Demo only: there is no server, so no real account is created. Your password is never stored.</p>`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showFormError(form, message) {
  const el = form.querySelector("[data-error]");
  el.textContent = message;
  el.hidden = false;
}

function handleAuth(form) {
  const data = new FormData(form);
  const email = String(data.get("email") || "").trim();
  const password = String(data.get("password") || "");
  const signup = state.authMode === "signup";
  let name = String(data.get("name") || "").trim();

  if (signup && !name) return showFormError(form, "Please enter your name.");
  if (!EMAIL_RE.test(email)) return showFormError(form, "Please enter a valid email address.");
  if (signup && password.length < 8) return showFormError(form, "Password must be at least 8 characters.");
  if (!signup && !password) return showFormError(form, "Please enter your password.");

  if (!name) {
    const prefix = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    name = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  }
  state.user = { name, email };
  writeStore(USER_KEY, state.user);
  renderNavs();
  showToast(`Welcome, ${name.split(" ")[0]}!`);
  showView("shop");
}

function handleSupport(form) {
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  const email = String(data.get("email") || "").trim();
  const message = String(data.get("message") || "").trim();

  if (!name) return showFormError(form, "Please enter your name.");
  if (!EMAIL_RE.test(email)) return showFormError(form, "Please enter a valid email address.");
  if (message.length < 10) return showFormError(form, "Please write a little more (at least 10 characters).");

  $("support-box").innerHTML = `
    <div class="cart-line py-6 text-center">
      <h2 class="text-2xl font-bold">Message sent</h2>
      <p class="mt-2 text-sm text-black/70">Thanks, ${esc(name.split(" ")[0])}. We will reply to ${esc(email)} within one business day.</p>
    </div>`;
  showToast("Message sent");
}

// ---------------------------------------------------------------------------
// 6. CART
// ---------------------------------------------------------------------------
function renderCart() {
  const entries = Object.entries(state.cart).filter(([id]) => productById(id));
  $("cart-subtotal").textContent = money.format(cartSubtotal());
  $("checkout").disabled = entries.length === 0;
  updateCartBadge();

  if (entries.length === 0) {
    $("cart-items").innerHTML = `
      <div class="flex h-full flex-col items-center justify-center text-center text-black/60">
        <p class="text-lg font-semibold text-black">Your cart is empty</p>
        <p class="mt-1 text-sm">Add something you like to get started.</p>
      </div>`;
    return;
  }

  $("cart-items").innerHTML = entries
    .map(([id, qty]) => {
      const p = productById(id);
      return `
      <div class="cart-line flex gap-4 border-b border-black/10 py-4">
        <div class="h-20 w-20 shrink-0 overflow-hidden rounded-2xl">${thumbHtml(p)}</div>
        <div class="flex flex-1 flex-col">
          <div class="flex items-start justify-between gap-2">
            <h4 class="text-sm font-semibold">${esc(p.name)}</h4>
            <span class="text-sm font-semibold">${money.format(p.price * qty)}</span>
          </div>
          <p class="text-xs text-black/50">${money.format(p.price)} each</p>
          <div class="mt-auto flex items-center justify-between">
            <div class="flex items-center gap-1 rounded-full border border-black/15">
              <button type="button" data-dec="${p.id}" aria-label="Decrease quantity" class="h-8 w-8 rounded-full text-lg leading-none transition hover:bg-black/5">−</button>
              <span class="w-6 text-center text-sm font-semibold">${qty}</span>
              <button type="button" data-inc="${p.id}" aria-label="Increase quantity" class="h-8 w-8 rounded-full text-lg leading-none transition hover:bg-black/5">+</button>
            </div>
            <button type="button" data-remove="${p.id}" class="text-xs font-semibold text-black/50 transition hover:text-black">Remove</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function changeQty(id, delta) {
  const next = (state.cart[id] || 0) + delta;
  if (next <= 0) delete state.cart[id];
  else state.cart[id] = next;
  writeStore(CART_KEY, state.cart);
  renderCart();
}

function addToCart(id) {
  changeQty(id, 1);
  updateCartBadge(true);
  showToast(`${productById(id).name} added to cart`);
}

function openCart() {
  $("drawer").classList.add("open");
  $("overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeCart() {
  $("drawer").classList.remove("open");
  $("overlay").classList.remove("open");
  document.body.style.overflow = "";
}

function checkout() {
  // Demo only: no payment is taken. Connect your payment provider here.
  const total = money.format(cartSubtotal());
  state.cart = {};
  writeStore(CART_KEY, state.cart);
  renderCart();
  closeCart();
  showToast(`Order placed: ${total}. Thank you!`);
}

// ---------------------------------------------------------------------------
// 7. PAGE SWITCHING
// ---------------------------------------------------------------------------
const RENDERERS = {
  shop: renderShop,
  new: renderNew,
  sale: renderSale,
  collections: renderCollections,
  signin: renderAuth,
};

function showView(name) {
  if (!VIEWS.includes(name)) name = "home";
  state.view = name;

  VIEWS.forEach((v) => {
    const el = $("view-" + v);
    el.hidden = v !== name;
    el.classList.remove("view-in");
  });

  if (RENDERERS[name]) RENDERERS[name]();
  const target = $("view-" + name);
  void target.offsetWidth; // restart the fade animation
  target.classList.add("view-in");

  closeCart();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// 8. EVENTS (one delegated listener for clicks, one for forms)
// ---------------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const t = e.target;
  const hit = (selector) => t.closest(selector);

  let el;
  if ((el = hit("[data-nav]"))) {
    e.preventDefault();
    return showView(el.dataset.nav);
  }
  if ((el = hit("[data-collection]"))) {
    state.category = el.dataset.collection;
    state.query = "";
    return showView("shop");
  }
  if ((el = hit("[data-category]"))) {
    state.category = el.dataset.category;
    return renderShop();
  }
  if ((el = hit("[data-add]"))) return addToCart(el.dataset.add);
  if ((el = hit("[data-inc]"))) return changeQty(el.dataset.inc, 1);
  if ((el = hit("[data-dec]"))) return changeQty(el.dataset.dec, -1);
  if ((el = hit("[data-remove]"))) {
    delete state.cart[el.dataset.remove];
    writeStore(CART_KEY, state.cart);
    return renderCart();
  }
  if (hit("[data-cart-open]")) return openCart();
  if (hit("#cart-close") || hit("#overlay")) return closeCart();
  if (hit("#checkout")) return checkout();
  if (hit("#reset-filters")) {
    state.category = "All";
    state.query = "";
    state.sort = "featured";
    return renderShop();
  }
  if ((el = hit("[data-auth-mode]"))) {
    state.authMode = el.dataset.authMode;
    return renderAuth();
  }
  if (hit("[data-signout]")) {
    state.user = null;
    writeStore(USER_KEY, null);
    renderNavs();
    renderAuth();
    return showToast("Signed out");
  }
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === "auth") handleAuth(form);
  if (form.dataset.form === "support") handleSupport(form);
});

document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    state.query = e.target.value;
    const list = visibleProducts();
    $("result-count").textContent = countText(list.length);
    $("empty-state").classList.toggle("hidden", list.length > 0);
    $("product-grid").innerHTML = list.map(cardHtml).join("");
  }
  const form = e.target.closest("[data-form]");
  if (form) form.querySelector("[data-error]").hidden = true;
});

document.addEventListener("change", (e) => {
  if (e.target.id === "sort") {
    state.sort = e.target.value;
    renderShop();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCart();
});

// ---------------------------------------------------------------------------
// 9. START
// ---------------------------------------------------------------------------
renderNavs();
renderCart();
createCloudShader(document.getElementById("cloud-shader"), { speed: 1 });
