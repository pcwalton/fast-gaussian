#version 300 es

// blur.fs.glsl

precision highp float;

#define SUPPORT 6.0

uniform sampler2D uTexture;
uniform float uSrcLength;
uniform float uCoeff;
uniform bool uVertical;

in vec2 vTexCoord;

out vec4 oFragColor;

vec4 sampleTexture(float x0, vec2 k) {
    float xMid = (x0 + k.y / (k.x + k.y)) / uSrcLength;
    vec2 texCoord = uVertical ? vec2(vTexCoord.x, xMid) : vec2(xMid, vTexCoord.y);
    return (k.x + k.y) * texture(uTexture, texCoord);
}

void main() {
    float center = (uVertical ? vTexCoord.y : vTexCoord.x) * uSrcLength;
    float start = floor(center - SUPPORT) + 0.5, end = ceil(center + SUPPORT) - 0.5;

    vec4 colorSum = vec4(0.0);
    float factorSum = 0.0;

    for (float x = start; x <= end; x += 2.0) {
        vec2 offsets = vec2(0.0, 1.0) + x - center;
        vec2 factors = exp(uCoeff * offsets * offsets);

        colorSum += sampleTexture(x, factors);
        factorSum += factors.x + factors.y;
    }

    oFragColor = colorSum / factorSum;
}
