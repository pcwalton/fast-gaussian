// up.fs.glsl

#define M_PI        3.141592653589793
#define SIGMA       0.25

precision highp float;

const float SIGMA_2_SQ = 2.0 * SIGMA * SIGMA;

uniform sampler2D uTexture;

varying vec2 vTexCoord;
uniform vec2 uSizeRecip;

void main() {
    vec2 coord = vTexCoord / uSizeRecip;
    vec2 pixCoord = floor(coord), subpixCoord = fract(coord) - 0.5;
    subpixCoord = 1.0 / sqrt(SIGMA_2_SQ * M_PI) * exp(-(subpixCoord * subpixCoord) / SIGMA_2_SQ);
    coord = pixCoord + subpixCoord + 0.5;
    vec2 texCoord = coord * uSizeRecip;
    gl_FragColor = texture2D(uTexture, texCoord);
}


