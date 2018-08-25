// gaussian-kawase/src/main.ts

import {ssim} from "ssim.js";

import SHADER_SOURCE_VERTEX from "./vertex.vs.glsl";
import SHADER_SOURCE_FRAGMENT_BLIT from "./blit.fs.glsl";
import SHADER_SOURCE_FRAGMENT_GAUSS_KAWASE from "./gauss-kawase.fs.glsl";

import IMAGE_PATH from "./fabio.jpg";

const VERTEX_DATA: Int8Array = new Int8Array([
    -1, -1,  0,  0,
    -1,  1,  0,  1,
     1, -1,  1,  0,
     1,  1,  1,  1,
]);

document.addEventListener('DOMContentLoaded', () => main());

function main(): void {
    const image = new Image;
    image.onload = () => (new App(image)).update();
    image.src = IMAGE_PATH;
}

class App {
    private radius: number;

    private image: HTMLImageElement;

    private canvasTest: HTMLCanvasElement;
    private canvasReference: HTMLCanvasElement;
    private ssimLabel: HTMLElement;
    private radiusSliderInput: HTMLInputElement;
    private radiusTextInput: HTMLInputElement;

    private gl: WebGLRenderingContext;
    private context2D: CanvasRenderingContext2D;

    private vertexBuffer: WebGLBuffer;
    private shaderProgramBlit: ShaderProgram;
    private shaderProgramGaussKawase: ShaderProgram;
    private imageTexture: WebGLTexture;
    private renderTargets: RenderTarget[];

    constructor(image: HTMLImageElement) {
        this.image = image;

        this.canvasTest = staticCast(document.getElementById('canvas-test'), HTMLCanvasElement);
        this.canvasReference = staticCast(document.getElementById('canvas-ref'),
                                           HTMLCanvasElement);
        this.ssimLabel = unwrap(document.getElementById('ssim'));
        this.radiusSliderInput = staticCast(document.getElementById('radius-slider'),
                                             HTMLInputElement);
        this.radiusTextInput = staticCast(document.getElementById('radius-text'),
                                           HTMLInputElement);

        this.radius = parseFloat(this.radiusTextInput.value);

        this.radiusSliderInput.addEventListener('change',
                                                event => this.updateRadius(event),
                                                false);
        this.radiusTextInput.addEventListener('change', event => this.updateRadius(event), false);

        resizeCanvas(this.canvasTest, image);
        resizeCanvas(this.canvasReference, image);

        const gl = unwrap(this.canvasTest.getContext('webgl'));
        this.gl = gl;
        this.context2D = unwrap(this.canvasReference.getContext('2d'));

        const vertexBuffer = unwrap(gl.createBuffer());
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, VERTEX_DATA, gl.STATIC_DRAW);
        this.vertexBuffer = vertexBuffer;

        this.shaderProgramBlit = new ShaderProgram(gl, SHADER_SOURCE_FRAGMENT_BLIT, vertexBuffer);
        this.shaderProgramGaussKawase = new ShaderProgram(gl,
                                                          SHADER_SOURCE_FRAGMENT_GAUSS_KAWASE,
                                                          vertexBuffer);

        const imageTexture = unwrap(gl.createTexture());
        this.imageTexture = imageTexture;
        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this.renderTargets = [new RenderTarget(gl), new RenderTarget(gl)];
    }

    update(): void {
        this.updateTest();
        this.updateReference();
        this.calculateSimilarity();
    }

    private updateRadius(event: Event): void {
        this.radius = parseFloat(staticCast(event.target, HTMLInputElement).value);
        this.radiusSliderInput.value = "" + this.radius;
        this.radiusTextInput.value = "" + this.radius;
        this.update();
    }

    private updateTest(): void {
        const gl = this.gl;

        const passCount = bestPassCount(this.radius);

        // Downsampling
        let width = this.canvasTest.width, height = this.canvasTest.height;
        let srcTexture = this.imageTexture;
        let pass = 0;
        while (pass < passCount) {
            const newWidth = width / 2, newHeight = height / 2;
            const renderTarget = this.renderTargets[pass % 2];
            renderTarget.resize(gl, newWidth, newHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget.framebuffer);

            this.drawQuad(gl,
                          this.shaderProgramBlit,
                          newWidth,
                          newHeight,
                          width,
                          height,
                          srcTexture);

            srcTexture = renderTarget.texture;
            width = newWidth;
            height = newHeight;

            pass++;
        }

        const stepRadius = bestStepRadius(passCount, this.radius);
        console.log("passes " + passCount + " step radius " + stepRadius);

        // Intermediate upsampling passes
        //while (pass < passCount * 2 - 1) {
            const newWidth = width * 2, newHeight = height * 2;

            const renderTarget = this.renderTargets[pass % 2];
            renderTarget.resize(gl, newWidth, newHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget.framebuffer);

            this.drawBlur(gl, stepRadius, newWidth, newHeight, width, height, srcTexture);

            srcTexture = renderTarget.texture;
            width = newWidth;
            height = newHeight;

            pass++;
        //}

        // Final upsampling pass
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.drawQuad(gl,
                      //stepRadius,
                      this.shaderProgramBlit,
                      this.canvasTest.width,
                      this.canvasTest.height,
                      width,
                      height,
                      srcTexture);
    }

    private drawBlur(gl: WebGLRenderingContext,
                     radius: number,
                     destWidth: number,
                     destHeight: number,
                     srcWidth: number,
                     srcHeight: number,
                     srcTexture: WebGLTexture):
                     void {
        const coeffs = [
            gauss2D(radius, 0.5, 0.5),
            gauss2D(radius, 0.5, 1.5),
            gauss2D(radius, 1.5, 1.5),
            gauss2D(radius, 2.5, 0.5),
            gauss2D(radius, 2.5, 1.5),
            gauss2D(radius, 2.5, 2.5),
        ];

        const coeffSum = 4.0 * (coeffs[0] + 2.0 * coeffs[1] + coeffs[2] +
                                2.0 * coeffs[3] + 2.0 * coeffs[4] + coeffs[5]);
        const coeffsInner = coeffs.slice(0, 3).map(x => x / coeffSum);
        const coeffsOuter = coeffs.slice(3, 6).map(x => x / coeffSum);

        const shaderProgram = this.shaderProgramGaussKawase;
        gl.useProgram(shaderProgram.program);
        gl.uniform3fv(shaderProgram.uniformCoeffsInner, coeffsInner);
        gl.uniform3fv(shaderProgram.uniformCoeffsOuter, coeffsOuter);
        this.drawQuad(gl, shaderProgram, destWidth, destHeight, srcWidth, srcHeight, srcTexture);
    }

    private drawQuad(gl: WebGLRenderingContext,
                     shaderProgram: ShaderProgram,
                     destWidth: number,
                     destHeight: number,
                     srcWidth: number,
                     srcHeight: number,
                     srcTexture: WebGLTexture):
                     void {
        gl.useProgram(shaderProgram.program);
        gl.viewport(0, 0, destWidth, destHeight);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTexture);
        gl.uniform1i(shaderProgram.uniformTexture, 0);
        gl.uniform2f(shaderProgram.uniformSizeRecip, 1.0 / srcWidth, 1.0 / srcHeight);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    private updateReference(): void {
        const canvas = this.canvasReference, context = this.context2D;
        context.fillStyle = 'black';
        context.fillRect(0, 0, canvas.width, canvas.height);
        (context as any).filter = "blur(" + this.radius + "px)";
        context.drawImage(this.image, 0, 0);
        (context as any).filter = null;
    }

    private calculateSimilarity(): void {
        this.canvasTest.toBlob(testBlobMaybe => {
            const testBlob = unwrap(testBlobMaybe);
            this.canvasReference.toBlob(refBlobMaybe => {
                const refBlob = unwrap(refBlobMaybe);

                const testURL = URL.createObjectURL(testBlob);
                const refURL = URL.createObjectURL(refBlob);
                ssim(testURL, refURL).then((result: any) => {
                    URL.revokeObjectURL(testURL);
                    URL.revokeObjectURL(refURL);

                    this.ssimLabel.innerHTML = result.mssim;
                });
            });
        })
    }
}

class RenderTarget {
    framebuffer: WebGLFramebuffer;
    texture: WebGLTexture;

    constructor(gl: WebGLRenderingContext) {
        this.texture = unwrap(gl.createTexture());
        this.framebuffer = unwrap(gl.createFramebuffer());
        this.resize(gl, 1, 1);
    }

    resize(gl: WebGLRenderingContext, width: number, height: number): void {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D,
                      0,
                      gl.RGBA,
                      width,
                      height,
                      0,
                      gl.RGBA,
                      gl.UNSIGNED_BYTE,
                      null);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,
                                gl.COLOR_ATTACHMENT0,
                                gl.TEXTURE_2D,
                                this.texture,
                                0);
    }
}

class ShaderProgram {
    program: WebGLProgram;
    uniformTexture: WebGLUniformLocation;
    uniformSizeRecip: WebGLUniformLocation | null;
    uniformCoeffsInner: WebGLUniformLocation | null;
    uniformCoeffsOuter: WebGLUniformLocation | null;

    constructor(gl: WebGLRenderingContext, fragmentShader: string, buffer: WebGLBuffer) {
        const shaderVertex = createShader(gl, 'vertex', SHADER_SOURCE_VERTEX);
        const shaderFragment = createShader(gl, 'fragment', fragmentShader);

        const program = unwrap(gl.createProgram());
        gl.attachShader(program, shaderVertex);
        gl.attachShader(program, shaderFragment);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw new Error("Linking failed: " + gl.getProgramInfoLog(program));
        this.program = program;

        gl.useProgram(program);
        const attribVertexPosition = gl.getAttribLocation(program, "aPosition");
        const attribTexCoord = gl.getAttribLocation(program, "aTexCoord");
        this.uniformTexture = unwrap(gl.getUniformLocation(program, "uTexture"));
        this.uniformSizeRecip = gl.getUniformLocation(program, "uSizeRecip");
        this.uniformCoeffsInner = gl.getUniformLocation(program, "uCoeffsInner");
        this.uniformCoeffsOuter = gl.getUniformLocation(program, "uCoeffsOuter");

        gl.vertexAttribPointer(attribVertexPosition, 2, gl.BYTE, false, 4, 0);
        gl.vertexAttribPointer(attribTexCoord, 2, gl.BYTE, false, 4, 2);
        gl.enableVertexAttribArray(attribVertexPosition);
        gl.enableVertexAttribArray(attribTexCoord);
    }
}

function createShader(gl: WebGLRenderingContext, kind: 'vertex' | 'fragment', source: string):
                      WebGLShader {
    const shaderKind = kind === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER;
    const shader = unwrap(gl.createShader(shaderKind));
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error("Compilation failed: " + gl.getShaderInfoLog(shader));
    return shader;
}

function resizeCanvas(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
    canvas.style.width = image.width / window.devicePixelRatio + "px";
    canvas.style.height = image.height / window.devicePixelRatio + "px";
    canvas.width = image.width;
    canvas.height = image.height;
}

function bestPassCount(radius: number): number {
    /*
    if (radius <= 3.0)
        return 1;
    if (radius <= 6.0)
        return 2;
    if (radius <= 13.0)
        return 3;
    if (radius <= 27.0)
        return 4;
    if (radius <= 55.0)
        return 5;
    return 6;
    */
    if (radius <= 4.0)
        return 1;
    if (radius <= 8.0)
        return 2;
    if (radius <= 16.0)
        return 3;
    if (radius <= 32.0)
        return 4;
    if (radius <= 64.0)
        return 5;
    return 6;
}

function bestStepRadius(passes: number, radius: number): number {
    /*let n = [1, 5, 21, 85, 341, 1365][passes - 1];
    return Math.sqrt(n) * radius / n;*/
    return radius / Math.pow(2, passes - 1);
}

function gauss2D(radius: number, x: number, y: number): number {
    const sigma = radius * 0.5;
    const invSigma2Sq = 1.0 / (2.0 * sigma * sigma);
    return invSigma2Sq / Math.PI * Math.exp(-(x * x + y * y) * invSigma2Sq);
}

function staticCast<T>(value: any, constructor: { new(...args: any[]): T }): T {
    if (!(value instanceof constructor))
        throw new Error("Invalid dynamic cast");
    return value;
}

function unwrap<T>(value: T | null | undefined): T {
    if (value == null)
        throw new Error("Unexpected null");
    return value;
}

function assert(cond: boolean, message?: string): void {
    if (!cond)
        throw new Error(message != null ? message : "Assertion failed");
}
