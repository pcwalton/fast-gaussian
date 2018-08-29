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

        const gl = unwrap(this.canvasTest.getContext('webgl', {antialias: false}));
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

        // Scheduling
        let passCount = 0/*, finalScaleFactor = 0*/;
        if (this.radius < 2.0) {
            // TODO(pcwalton)
            passCount = 1;
            //finalScaleFactor = 1.0;
        } else if (this.radius < 4.0) {
            passCount = 2;
        } else if (this.radius < 9.0) {
            passCount = 3;
            //finalScaleFactor = 0.25 * Math.sqrt((this.radius - 4.0) * (this.radius + 4.0));
        } else if (this.radius < 18.0) {
            passCount = 4;
            //finalScaleFactor = Math.sqrt(this.radius * this.radius - 80.0) / 8.0;
        } else if (this.radius < 37.0) {
            passCount = 5;
            //finalScaleFactor = Math.sqrt(this.radius * this.radius - 336.0) / 16.0;
        } else if (this.radius < 74.0) {
            passCount = 6;
            /*finalScaleFactor =
                Math.sqrt(this.radius / 4096.0 - 21.0 / 16.0 - Math.sqrt(5.0) / 1024.0);*/
        } else if (this.radius < 148.0) {
            passCount = 7;
            /*finalScaleFactor =
                Math.sqrt(this.radius / 16384.0 - 85.0 / 64.0 - Math.sqrt(5.0) - 4096.0);*/
        } else {
            passCount = 8;
            /*finalScaleFactor =
                Math.sqrt(this.radius / 65536.0 - 341.0 / 256.0 - Math.sqrt(5.0) / 16384.0);*/
        }
        console.log("passes " + passCount + " radius " + this.radius);

        // Downsampling
        let width = this.canvasTest.width, height = this.canvasTest.height;
        let srcTexture = this.imageTexture;
        let pass = 0;
        while (pass < passCount) {
            //const scaleFactor = pass < passCount - 1 ? 2.0 : finalScaleFactor;
            const scaleFactor = 2.0;
            const newWidth = width / scaleFactor, newHeight = height / scaleFactor;
            console.log("pass=", pass, "scaleFactor=", scaleFactor);

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

        // Intermediate upsampling passes
        const penultPass = pass + passCount - 1;
        while (pass < penultPass) {
            const scaleFactor = 2.0;
            const newWidth = width * scaleFactor, newHeight = height * scaleFactor;

            const renderTarget = this.renderTargets[pass % 2];
            renderTarget.resize(gl, newWidth, newHeight);
            console.log("upsample: newWidth=", newWidth, "newHeight=", newHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget.framebuffer);

            this.drawBlur(gl, 2.0, newWidth, newHeight, width, height, srcTexture);

            srcTexture = renderTarget.texture;
            width = newWidth;
            height = newHeight;

            pass++;
        }

        // Final upsampling pass
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.drawBlur(gl,
                      2.0/*this.shaderProgramBlit*/,
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
        console.log("drawBlur(", radius, destWidth, destHeight, srcWidth, srcHeight, ")");
        const coeffs = [
            gauss2D(radius,  0.0,  0.0),    // 0
            gauss2D(radius,  1.0,  0.0),    // 1
            gauss2D(radius,  2.0,  0.0),    // 2
            gauss2D(radius,  0.0,  1.0),    // 3
            gauss2D(radius,  1.0,  1.0),    // 4
            gauss2D(radius,  2.0,  1.0),    // 5
            gauss2D(radius,  0.0,  2.0),    // 6
            gauss2D(radius,  1.0,  2.0),    // 7
            gauss2D(radius,  2.0,  2.0),    // 8
        ];

        const coeffSum =
            coeffs[0] +
            2.0 * (coeffs[1] + coeffs[2]) +
            2.0 * (coeffs[3] + coeffs[6]) +
            4.0 * (coeffs[4] + coeffs[5] + coeffs[7] + coeffs[8]);

        for (let i = 0; i < coeffs.length; i++)
            coeffs[i] /= coeffSum;

        const coeffRow0 = [coeffs[0], coeffs[1], coeffs[2]];
        const coeffRow1 = [coeffs[3], coeffs[4], coeffs[5]];
        const coeffRow2 = [coeffs[6], coeffs[7], coeffs[8]];

        const shaderProgram = this.shaderProgramGaussKawase;
        //const shaderProgram = this.shaderProgramBlit;
        gl.useProgram(shaderProgram.program);
        gl.uniform3fv(shaderProgram.uniformCoeffRow0, coeffRow0);
        gl.uniform3fv(shaderProgram.uniformCoeffRow1, coeffRow1);
        gl.uniform3fv(shaderProgram.uniformCoeffRow2, coeffRow2);
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
        gl.uniform2f(shaderProgram.uniformDestSizeRecip, 1.0 / destWidth, 1.0 / destHeight);
        gl.uniform2f(shaderProgram.uniformSrcSizeRecip, 1.0 / srcWidth, 1.0 / srcHeight);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    private updateReference(): void {
        const canvas = this.canvasReference, context = this.context2D;
        context.fillStyle = 'black';
        context.fillRect(0, 0, canvas.width, canvas.height);
        (context as any).filter = "blur(" + (this.radius / 2) + "px)";
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
    uniformDestSizeRecip: WebGLUniformLocation | null;
    uniformSrcSizeRecip: WebGLUniformLocation | null;
    uniformCoeffRow0: WebGLUniformLocation | null;
    uniformCoeffRow1: WebGLUniformLocation | null;
    uniformCoeffRow2: WebGLUniformLocation | null;

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
        this.uniformDestSizeRecip = gl.getUniformLocation(program, "uDestSizeRecip");
        this.uniformSrcSizeRecip = gl.getUniformLocation(program, "uSrcSizeRecip");
        this.uniformCoeffRow0 = gl.getUniformLocation(program, "uCoeffRow0");
        this.uniformCoeffRow1 = gl.getUniformLocation(program, "uCoeffRow1");
        this.uniformCoeffRow2 = gl.getUniformLocation(program, "uCoeffRow2");

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

type ScheduleEntry = {
    radius: number;
    width: number;
    height: number;
};
