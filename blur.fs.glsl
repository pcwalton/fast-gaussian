#version 300 es

// blur.fs.glsl

precision highp float;

#define SUPPORT 4.0

uniform sampler2D uTexture;
uniform vec2 uSrcSize;
uniform float uCoeff;
uniform bool uVertical;

in vec2 vTexCoord;

out vec4 oFragColor;

void accum(float x,
           float srcLengthRecip,
           inout vec3 g,
           inout vec4 colorSum,
           inout float factorSum) {
    float factorA = g.x;
    g.xy *= g.yz;
    float factorB = g.x;
    g.xy *= g.yz;

    float factors = factorA + factorB;
    float xMid = (x + factorB / factors) * srcLengthRecip;
    vec2 texCoord = uVertical ? vec2(vTexCoord.x, xMid) : vec2(xMid, vTexCoord.y);

    colorSum += factors * texture(uTexture, texCoord);
    factorSum += factors;
}

void main() {
    float srcLength = uVertical ? uSrcSize.y : uSrcSize.x;
    float srcLengthRecip = 1.0 / srcLength;

    float center = (uVertical ? vTexCoord.y : vTexCoord.x) * srcLength;
    float start = floor(center - SUPPORT) + 0.5, end = ceil(center + SUPPORT) - 0.5;

    float offset = start - center;
    vec3 g = exp(uCoeff * vec3(offset * offset, 2.0 * offset + 1.0, 2.0));

    vec4 colorSum = vec4(0.0);
    float factorSum = 0.0;

    accum(start,        srcLengthRecip, g, colorSum, factorSum);
    accum(start + 2.0,  srcLengthRecip, g, colorSum, factorSum);
    accum(start + 4.0,  srcLengthRecip, g, colorSum, factorSum);
    accum(start + 6.0,  srcLengthRecip, g, colorSum, factorSum);
    accum(start + 8.0,  srcLengthRecip, g, colorSum, factorSum);

    oFragColor = colorSum / factorSum;
}
