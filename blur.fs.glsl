#version 300 es

// blur.fs.glsl

precision highp float;

#define SUPPORT 6.0

uniform sampler2D uTexture;
uniform vec2 uSrcSize;
uniform float uCoeff;
uniform bool uVertical;

in vec2 vTexCoord;

out vec4 oFragColor;

void main() {
    float srcLength = uVertical ? uSrcSize.y : uSrcSize.x;
    float center = (uVertical ? vTexCoord.y : vTexCoord.x) * srcLength;
    float start = floor(center - SUPPORT) + 0.5, end = ceil(center + SUPPORT) - 0.5;

    vec4 colorSum = vec4(0.0);
    float factorSum = 0.0;

    for (float x = start; x <= end; x += 2.0) {
        vec2 offsets = vec2(0.0, 1.0) + x - center;
        vec2 factors = exp(uCoeff * offsets * offsets);

        float bothFactors = factors.x + factors.y;
        float xMid = (x + factors.y / bothFactors) / srcLength;
        vec2 texCoord = uVertical ? vec2(vTexCoord.x, xMid) : vec2(xMid, vTexCoord.y);

        colorSum += bothFactors * texture(uTexture, texCoord);
        factorSum += bothFactors;
    }

    oFragColor = colorSum / factorSum;
}
