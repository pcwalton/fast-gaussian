#version 300 es

// dual-up.fs.glsl

precision highp float;

#define SUPPORT 6.0

uniform sampler2D uTexture;
uniform vec2 uSrcSize;
uniform float uCoeff;
uniform bool uVertical;

in vec2 vTexCoord;

out vec4 oFragColor;

void main() {
    vec2 halfpixel = 0.5 / uSrcSize;
    vec4 sum = texture(uTexture, vTexCoord + vec2(-halfpixel.x * 2.0, 0.0));
    sum += texture(uTexture, vTexCoord + vec2(-halfpixel.x, halfpixel.y)) * 2.0;
    sum += texture(uTexture, vTexCoord + vec2(0.0, halfpixel.y * 2.0));
    sum += texture(uTexture, vTexCoord + vec2(halfpixel.x, halfpixel.y)) * 2.0;
    sum += texture(uTexture, vTexCoord + vec2(halfpixel.x * 2.0, 0.0));
    sum += texture(uTexture, vTexCoord + vec2(halfpixel.x, -halfpixel.y)) * 2.0;
    sum += texture(uTexture, vTexCoord + vec2(0.0, -halfpixel.y * 2.0));
    sum += texture(uTexture, vTexCoord + vec2(-halfpixel.x, -halfpixel.y)) * 2.0;
    oFragColor = sum / 12.0;
}
