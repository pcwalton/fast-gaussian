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

void main() {
    float center = (uVertical ? vTexCoord.y : vTexCoord.x) * uSrcLength;
    float start = floor(center - SUPPORT) + 0.5, end = ceil(center + SUPPORT) - 0.5;

    vec4 colorSum = vec4(0.0);
    float factorSum = 0.0;

    for (float x = start; x <= end; x += 1.0) {
        float texX = x / uSrcLength;
        vec2 texCoord = uVertical ? vec2(vTexCoord.x, texX) : vec2(texX, vTexCoord.y);

        float offset = x - center;
        float factor = exp(uCoeff * offset * offset);

        colorSum += texture(uTexture, texCoord) * factor;
        factorSum += factor;
    }

    oFragColor = colorSum / factorSum;
}
