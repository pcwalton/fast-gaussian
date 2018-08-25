// gauss-kawase.fs.glsl

precision highp float;

uniform sampler2D uTexture;
uniform vec2 uSizeRecip;
uniform vec3 uCoeffsInner;
uniform vec3 uCoeffsOuter;

varying vec2 vTexCoord;

vec4 sample(vec2 offset, float factor) {
    return texture2D(uTexture, vTexCoord + uSizeRecip * offset) * factor;
}

vec4 sample4(vec2 offset, float factor) {
    return sample(offset, factor) +
        sample(vec2(-offset.x,  offset.y), factor) +
        sample(vec2( offset.x, -offset.y), factor) +
        sample(-offset, factor);
}

void main() {
    gl_FragColor =

// 6x6 kernel:
        sample4(vec2(0.5, 0.5), uCoeffsInner.x) +
        sample4(vec2(1.5, 0.5), uCoeffsInner.y) +
        sample4(vec2(0.5, 1.5), uCoeffsInner.y) +
        sample4(vec2(1.5, 1.5), uCoeffsInner.z) +
        sample4(vec2(0.5, 2.5), uCoeffsOuter.x) +
        sample4(vec2(2.5, 0.5), uCoeffsOuter.x) +
        sample4(vec2(2.5, 1.5), uCoeffsOuter.y) +
        sample4(vec2(1.5, 2.5), uCoeffsOuter.y) +
        sample4(vec2(2.5, 2.5), uCoeffsOuter.z);

#if 0
// 6x6 kernel, 1.5px:
        sample4(vec2(0.5, 0.5), 0.18143508) +
        sample4(vec2(1.5, 0.5), 0.03066494) +
        sample4(vec2(2.5, 0.5), 0.00087596) +
        sample4(vec2(0.5, 1.5), 0.03066494) +
        sample4(vec2(1.5, 1.5), 0.00518278) +
        sample4(vec2(2.5, 1.5), 0.00014805) +
        sample4(vec2(0.5, 2.5), 0.00087596) +
        sample4(vec2(1.5, 2.5), 0.00014805) +
        sample4(vec2(2.5, 2.5), 0.00000423);
#endif

#if 0
// 6x6 kernel, 2.5px:
        sample4(vec2(0.5, 0.5), 0.08922392) +
        sample4(vec2(1.5, 0.5), 0.0470471) +
        sample4(vec2(2.5, 0.5), 0.01308085) +
        sample4(vec2(0.5, 1.5), 0.0470471) +
        sample4(vec2(1.5, 1.5), 0.02480758) +
        sample4(vec2(2.5, 1.5), 0.00689743) +
        sample4(vec2(0.5, 2.5), 0.01308085) +
        sample4(vec2(1.5, 2.5), 0.00689743) +
        sample4(vec2(2.5, 2.5), 0.00191774);
#endif

#if 0
// 6x6 kernel, 2px:
        sample4(vec2(0.5, 0.5), 0.12439183) +
        sample4(vec2(1.5, 0.5), 0.04576120) +
        sample4(vec2(2.5, 0.5), 0.00619310) +
        sample4(vec2(0.5, 1.5), 0.04576120) +
        sample4(vec2(1.5, 1.5), 0.01683460) +
        sample4(vec2(2.5, 1.5), 0.00227832) +
        sample4(vec2(0.5, 2.5), 0.00619310) +
        sample4(vec2(1.5, 2.5), 0.00227832) +
        sample4(vec2(2.5, 2.5), 0.00030834);
#endif
}

#if 0
// 8x8 kernel:
        sample4(vec2(3.5, 3.5), 0.00250996) +
        sample4(vec2(2.5, 3.5), 0.00495571) + sample4(vec2(3.5, 2.5), 0.00495571) +
        sample4(vec2(2.5, 2.5), 0.00978463) +
        sample4(vec2(1.5, 3.5), 0.00779947) + sample4(vec2(3.5, 1.5), 0.00779947) +
        sample4(vec2(1.5, 2.5), 0.01539938) + sample4(vec2(2.5, 1.5), 0.01539938) +
        sample4(vec2(1.5, 1.5), 0.02423608) +
        sample4(vec2(0.5, 3.5), 0.00978463) + sample4(vec2(3.5, 0.5), 0.00978463) +
        sample4(vec2(0.5, 2.5), 0.01931892) + sample4(vec2(2.5, 0.5), 0.01931892) +
        sample4(vec2(0.5, 1.5), 0.03040477) + sample4(vec2(1.5, 0.5), 0.03040477) +
        sample4(vec2(0.5, 0.5), 0.03814356);
#endif
