// srcUV = xf.zw + uv * xf.xy: the cover transform every scene shares (negative x scale = mirrored)
vec2 coverUV(vec2 uv, vec4 xf) { return xf.zw + uv * xf.xy; }
float inside01(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }
float aastep(float threshold, float value) { float w = fwidth(value) * 0.75; return smoothstep(threshold - w, threshold + w, value); }
float sat(float x) { return clamp(x, 0.0, 1.0); }
