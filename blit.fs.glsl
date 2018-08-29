#version 300 es

// blit.fs.glsl

precision highp float;

uniform sampler2D uTexture;

in vec2 vTexCoord;

out vec4 oFragColor;

void main() {
    oFragColor = texture(uTexture, vTexCoord);
}

