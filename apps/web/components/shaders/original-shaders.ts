// SPDX-License-Identifier: MIT
// Original MediaFlock surface shaders. No upstream orb formulas are included.
import { d } from "typegpu";
import type { OrbVariant } from "@/components/orbs/renderer";

const uniforms = d.struct({
  time: d.f32,
  anim: d.f32,
  inputVol: d.f32,
  outputVol: d.f32,
  res: d.vec2f,
  p_speed: d.f32,
  p_detail: d.f32,
  c_body: d.vec3f,
  c_sheen: d.vec3f,
});

// Direct sphere shading keeps each pixel bounded: no raymarching or textures.
function shader(detail: string) {
  return /* wgsl */ `
struct Params {
  time: f32,
  anim: f32,
  inputVol: f32,
  outputVol: f32,
  res: vec2f,
  p_speed: f32,
  p_detail: f32,
  c_body: vec3f,
  c_sheen: vec3f,
}
@group(0) @binding(0) var<uniform> params: Params;

@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let shortest = max(min(params.res.x, params.res.y), 1.0);
  let p = (uv * 2.0 - vec2f(1.0)) * params.res / shortest;
  let r = length(p);
  let coverage = 1.0 - smoothstep(0.775, 0.80, r);
  if (coverage <= 0.0) { return vec4f(0.0); }

  let q = p / 0.80;
  let z = sqrt(max(0.0, 1.0 - dot(q, q)));
  let n = normalize(vec3f(q.x, -q.y, z));
  let light = normalize(vec3f(-0.45, 0.70, 1.0));
  let diffuse = max(dot(n, light), 0.0);
  let halfway = normalize(light + vec3f(0.0, 0.0, 1.0));
  let highlight = pow(max(dot(n, halfway), 0.0), 28.0);
  let rim = pow(1.0 - z, 3.0);
  let t = params.time * params.p_speed;
  var color = mix(params.c_body, params.c_sheen, 0.12 + diffuse * 0.48);
  color += params.c_sheen * (highlight * 0.48 + rim * 0.10);
  ${detail}
  return vec4f(max(color, vec3f(0.0)) * coverage, coverage);
}`;
}

function variant(key: string, label: string, detail: string): OrbVariant {
  return {
    key,
    label,
    note: "Original decorative MediaFlock shader",
    shader: shader(detail),
    uniforms,
    params: [
      {
        key: "speed",
        label: "Motion",
        min: 0,
        max: 2,
        step: 0.05,
        default: 0.35,
      },
      {
        key: "detail",
        label: "Surface detail",
        min: 0,
        max: 1,
        step: 0.05,
        default: 0.45,
      },
    ],
    colors: [
      { key: "body", label: "Body", default: "#77777e" },
      { key: "sheen", label: "Sheen", default: "#f1f1f3" },
    ],
    statePresets: {
      idle: { speed: 0.35, detail: 0.45 },
      thinking: { speed: 0.85, detail: 0.62 },
    },
  };
}

export const composeOrb = variant(
  "mediaflock-compose",
  "Composing",
  /* wgsl */ `
    let fold = n.y + 0.17 * sin(n.x * 5.0 + t);
    let band = pow(0.5 + 0.5 * cos(fold * 19.0 - t * 1.4), 5.0);
    color = mix(color, params.c_sheen, band * params.p_detail * 0.38);
    color *= 0.92 + 0.08 * sin(fold * 10.0 + t * 0.6);
  `,
);

export const processOrb = variant(
  "mediaflock-process",
  "Processing",
  /* wgsl */ `
    let angle = t * 0.55;
    let c = cos(angle);
    let s = sin(angle);
    let axis = mat2x2f(vec2f(c, s), vec2f(-s, c)) * n.xy;
    let orbitA = exp(-pow((axis.y + 0.22 * n.z) * 25.0, 2.0));
    let orbitB = exp(-pow((axis.x - 0.32 * n.z) * 29.0, 2.0));
    let track = max(orbitA, orbitB * 0.75);
    color = mix(color, params.c_sheen, track * params.p_detail * 0.85);
    let segment = pow(0.5 + 0.5 * sin(axis.x * 8.0 - t * 2.0), 3.0);
    color += params.c_sheen * track * segment * 0.10;
  `,
);

export const insightsOrb = variant(
  "mediaflock-insights",
  "Insights",
  /* wgsl */ `
    var dots = 0.0;
    for (var i: i32 = 0; i < 7; i += 1) {
      let angle = f32(i) * 0.8975979 + t * 0.06;
      let radius = 0.43 + 0.08 * sin(f32(i) * 2.1);
      let point = vec2f(cos(angle), sin(angle)) * radius;
      let delta = q - point;
      dots += exp(-dot(delta, delta) * 2100.0);
    }
    let contour = pow(0.5 + 0.5 * cos((n.y + n.x * 0.30) * 15.0 + t * 0.4), 18.0);
    color = mix(color, params.c_sheen, contour * params.p_detail * 0.14);
    color += params.c_sheen * min(dots, 1.0) * 0.42;
  `,
);
