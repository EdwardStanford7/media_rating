import { useEffect, useRef } from "react";

/*
 * A calm WebGL atmosphere for the marketing page: a slow domain-warped field
 * that drifts between deep ink, aubergine, and a soft gold pool. No
 * dependencies (raw WebGL1 for compatibility). Two deliberate choices keep it
 * smooth rather than glitchy: there is no per-frame grain in the shader (a
 * static CSS grain overlay supplies texture instead, so nothing flickers), and
 * a stable, time-independent dither removes the 8-bit banding that otherwise
 * shows in large gradients. Falls back to the CSS field underneath if WebGL is
 * unavailable, and renders a single frame under prefers-reduced-motion.
 */

const FRAGMENT_SHADER = `
precision highp float;
uniform float u_time;
uniform vec2 u_res;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_res.xy;
    vec2 p = uv;
    p.x *= u_res.x / u_res.y;
    float t = u_time * 0.026;

    // Two-stage domain warp for a more organic, slowly evolving flow.
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(3.0, 1.0 - t)));
    vec2 r = vec2(
        fbm(p + 1.4 * q + vec2(1.7, 9.2) + 0.14 * t),
        fbm(p + 1.4 * q + vec2(8.3, 2.8) - 0.11 * t)
    );
    float n = fbm(p + 1.3 * r + 0.22 * t);

    // Low-contrast palette anchored near the theme's dark aubergine.
    vec3 base = vec3(0.055, 0.043, 0.094);
    vec3 plum = vec3(0.140, 0.078, 0.185);
    vec3 gold = vec3(0.620, 0.460, 0.180);

    vec3 col = mix(base, plum, smoothstep(0.25, 0.82, n));

    // A soft gold light pool toward the top-right corner.
    float g = smoothstep(0.50, 1.0, n) * smoothstep(1.15, 0.15, distance(uv, vec2(0.86, 0.98)));
    col = mix(col, gold, g * 0.38);

    // A slow sheen drifting through the bright region, like light on gilt.
    float sheen = 0.5 + 0.5 * sin((uv.x + uv.y) * 3.0 - u_time * 0.14 + n * 3.0);
    sheen = smoothstep(0.55, 1.0, sheen);
    col += gold * sheen * g * 0.14;

    // A faint cool counter-glow lower-left so the field is not one-sided.
    float c2 = smoothstep(0.55, 1.0, n) * smoothstep(1.0, 0.1, distance(uv, vec2(0.08, 0.05)));
    col = mix(col, vec3(0.28, 0.22, 0.46), c2 * 0.18);

    // Stable spatial dither (no time term) defeats banding without flicker.
    float d = hash(gl_FragCoord.xy) - 0.5;
    col += d * (1.5 / 255.0);

    gl_FragColor = vec4(col, 1.0);
}
`;

const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
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

export function GildedBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const gl =
            canvas.getContext("webgl", { antialias: false, alpha: true }) ??
            (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
        if (!gl) return;

        const vert = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
        const frag = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
        if (!vert || !frag) return;

        const program = gl.createProgram();
        if (!program) return;
        gl.attachShader(program, vert);
        gl.attachShader(program, frag);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
        gl.useProgram(program);

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const posLoc = gl.getAttribLocation(program, "a_pos");
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        const timeLoc = gl.getUniformLocation(program, "u_time");
        const resLoc = gl.getUniformLocation(program, "u_res");

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const resize = () => {
            const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
            const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(resLoc, canvas.width, canvas.height);
        };
        resize();
        window.addEventListener("resize", resize);

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const draw = (timeMs: number) => {
            gl.uniform1f(timeLoc, timeMs / 1000);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        };

        let frame = 0;
        let running = true;

        if (reduceMotion) {
            draw(6000);
        } else {
            const loop = (timeMs: number) => {
                if (!running) return;
                draw(timeMs);
                frame = requestAnimationFrame(loop);
            };
            frame = requestAnimationFrame(loop);
        }

        const onVisibility = () => {
            if (reduceMotion) return;
            if (document.hidden) {
                running = false;
                cancelAnimationFrame(frame);
            } else if (!running) {
                running = true;
                frame = requestAnimationFrame(function resume(timeMs) {
                    if (!running) return;
                    draw(timeMs);
                    frame = requestAnimationFrame(resume);
                });
            }
        };
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            running = false;
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", resize);
            document.removeEventListener("visibilitychange", onVisibility);
            gl.deleteProgram(program);
            gl.deleteShader(vert);
            gl.deleteShader(frag);
            gl.deleteBuffer(buffer);
        };
    }, []);

    return <canvas ref={canvasRef} className="gs-canvas" aria-hidden="true" />;
}
