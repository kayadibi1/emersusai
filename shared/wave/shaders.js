/* shared/wave/shaders.js
 *
 * GLSL for the landing hero sea-wave wireframe (v2).
 *
 * A flat 2D plane in 3D holds N horizontal fibers stacked along Z.
 * In the vertex shader each point gets a Y displacement driven by a
 * traveling wave `A·sin(k_x·x + k_z·z + ω·t)` plus a second, slower
 * harmonic. A global amplitude term pulses between concave and convex.
 *
 * The fragment shader samples a 4-stop horizontal colour ramp, with
 * smooth fades at the left/right screen edges and a depth-based dim on
 * fibers far from the camera.
 */

export const VERTEX_SHADER = /* glsl */ `
  precision highp float;
  attribute float aFiber;

  uniform float uTime;
  uniform float uWidth;
  uniform float uFiberCount;
  uniform float uSpread;
  uniform float uAmpX;
  uniform float uFreqX;
  uniform float uFreqZ;
  uniform float uSpeed;
  uniform float uBreatheAmp;
  uniform float uBreatheFreq;
  uniform float uYoff;

  varying float vRamp;
  varying float vDepth;

  void main() {
    float x = position.x;
    float fiber = aFiber / max(uFiberCount - 1.0, 1.0);
    float z = (fiber - 0.5) * uSpread;
    float u = x / (uWidth * 0.5);

    float phase  = u * uFreqX * 3.14159 + z * uFreqZ + uTime * uSpeed;
    float phase2 = u * uFreqX * 1.35 * 3.14159 - z * uFreqZ * 0.7 + uTime * uSpeed * 0.55;
    float yWave = uAmpX * (sin(phase) + 0.35 * sin(phase2));
    yWave *= 1.0 + uBreatheAmp * sin(uTime * uBreatheFreq);

    float y = yWave + uYoff;
    vec4 mvPosition = modelViewMatrix * vec4(x, y, z, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    vRamp  = (u + 1.0) * 0.5;
    vDepth = z;
  }
`;

export const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3  uC0;
  uniform vec3  uC1;
  uniform vec3  uC2;
  uniform vec3  uC3;
  uniform float uAlpha;
  uniform float uSpread;
  varying float vRamp;
  varying float vDepth;

  vec3 ramp4(vec3 c0, vec3 c1, vec3 c2, vec3 c3, float t) {
    float s = t * 3.0;
    if (s < 1.0) return mix(c0, c1, s);
    if (s < 2.0) return mix(c1, c2, s - 1.0);
    return mix(c2, c3, clamp(s - 2.0, 0.0, 1.0));
  }

  void main() {
    float edge  = smoothstep(0.0, 0.12, vRamp) * smoothstep(1.0, 0.88, vRamp);
    float depth = 1.0 - clamp((vDepth + uSpread * 0.5) / uSpread, 0.0, 1.0) * 0.55;
    vec3 colour = ramp4(uC0, uC1, uC2, uC3, vRamp);
    gl_FragColor = vec4(colour, uAlpha * edge * depth);
  }
`;
