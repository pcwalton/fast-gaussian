// gaussian-kawase/src/main.ts

import {ssim} from "ssim.js";

import SHADER_SOURCE_VERTEX from "./vertex.vs.glsl";
import SHADER_SOURCE_FRAGMENT_BLIT from "./blit.fs.glsl";
import SHADER_SOURCE_FRAGMENT_BLUR from "./blur.fs.glsl";
import SHADER_SOURCE_FRAGMENT_DUAL_DOWN from "./dual-down.fs.glsl";
import SHADER_SOURCE_FRAGMENT_DUAL_UP from "./dual-up.fs.glsl";

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
    private method: 'gaussian' | 'dual';

    private image: HTMLImageElement;

    private canvasTest: HTMLCanvasElement;
    private canvasReference: HTMLCanvasElement;
    private methodSelect: HTMLSelectElement;
    private ssimLabel: HTMLElement;
    private timeLabel: HTMLElement;
    private radiusSliderInput: HTMLInputElement;
    private radiusTextInput: HTMLInputElement;

    private gl: WebGL2RenderingContext;
    private disjointTimerQueryExt: any | null;
    private context2D: CanvasRenderingContext2D;

    private vertexBuffer: WebGLBuffer;
    private shaderProgramBlit: ShaderProgram;
    private shaderProgramBlur: ShaderProgram;
    private shaderProgramDualDown: ShaderProgram;
    private shaderProgramDualUp: ShaderProgram;
    private imageTexture: WebGLTexture;
    private renderTargets: RenderTargetMap;
    private query: WebGLQuery;

    constructor(image: HTMLImageElement) {
        this.image = image;

        this.canvasTest = staticCast(document.getElementById('canvas-test'), HTMLCanvasElement);
        this.canvasReference = staticCast(document.getElementById('canvas-ref'),
                                           HTMLCanvasElement);
        this.methodSelect = staticCast(document.getElementById('method'), HTMLSelectElement);
        this.ssimLabel = unwrap(document.getElementById('ssim'));
        this.timeLabel = unwrap(document.getElementById('time'));
        this.radiusSliderInput = staticCast(document.getElementById('radius-slider'),
                                             HTMLInputElement);
        this.radiusTextInput = staticCast(document.getElementById('radius-text'),
                                           HTMLInputElement);

        this.method = this.methodSelect.selectedIndex == 0 ? 'gaussian' : 'dual';
        this.methodSelect.addEventListener('change', () => this.updateMethod(), false);

        const redrawButton = unwrap(document.getElementById('redraw'));
        redrawButton.addEventListener('click', () => this.update(), false);

        this.radius = parseFloat(this.radiusTextInput.value);
        this.radiusSliderInput.addEventListener('change',
                                                event => this.updateRadius(event),
                                                false);
        this.radiusTextInput.addEventListener('change', event => this.updateRadius(event), false);

        resizeCanvas(this.canvasTest, image);
        resizeCanvas(this.canvasReference, image);

        const gl = unwrap(this.canvasTest.getContext('webgl2', {antialias: false}));
        this.gl = gl;
        this.disjointTimerQueryExt = gl.getExtension('EXT_disjoint_timer_query');
        this.context2D = unwrap(this.canvasReference.getContext('2d'));

        const vertexBuffer = unwrap(gl.createBuffer());
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, VERTEX_DATA, gl.STATIC_DRAW);
        this.vertexBuffer = vertexBuffer;

        this.shaderProgramBlit = new ShaderProgram(gl, SHADER_SOURCE_FRAGMENT_BLIT, vertexBuffer);
        this.shaderProgramBlur = new ShaderProgram(gl, SHADER_SOURCE_FRAGMENT_BLUR, vertexBuffer);
        this.shaderProgramDualDown = new ShaderProgram(gl,
                                                       SHADER_SOURCE_FRAGMENT_DUAL_DOWN,
                                                       vertexBuffer);
        this.shaderProgramDualUp = new ShaderProgram(gl,
                                                     SHADER_SOURCE_FRAGMENT_DUAL_UP,
                                                     vertexBuffer);

        const imageTexture = unwrap(gl.createTexture());
        this.imageTexture = imageTexture;
        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this.renderTargets = {};

        this.query = unwrap(gl.createQuery());
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
        // FIXME(pcwalton): 1.0 should be 0.0
        const passCount = Math.max(1.0, Math.floor(Math.log2(this.radius)) - 1.0);

        // Start query.
        if (this.disjointTimerQueryExt != null) {
            gl.beginQuery(this.disjointTimerQueryExt.TIME_ELAPSED_EXT, this.query);
        }

        // Downsampling
        let width = this.canvasTest.width, height = this.canvasTest.height;
        let srcTexture = this.imageTexture;
        let pass = 0;
        while (pass < passCount) {
            const scaleFactor = 2.0;
            const newWidth = width / scaleFactor, newHeight = height / scaleFactor;

            const renderTarget = this.getRenderTarget(newWidth, newHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget.framebuffer);

            let program = this.shaderProgramBlit;
            if (this.method === 'dual')
                program = this.shaderProgramDualDown;
            this.drawQuad(program, newWidth, newHeight, width, height, srcTexture);

            srcTexture = renderTarget.texture;
            width = newWidth;
            height = newHeight;

            pass++;
        }

        switch (this.method) {
        case 'gaussian':
            this.drawGaussianBlur(srcTexture, width, height, passCount);
            break;
        case 'dual':
            this.drawDualBlur(srcTexture, width, height, passCount);
            break;
        }

        // End query.
        gl.endQuery(this.disjointTimerQueryExt.TIME_ELAPSED_EXT);
        setTimeout(() => {
            if (this.disjointTimerQueryExt != null) {
                const timeElapsed = this.disjointTimerQueryExt
                                        .getQueryObjectEXT(this.query,
                                                           this.disjointTimerQueryExt
                                                               .QUERY_RESULT_EXT) / 1000000.0;
                this.timeLabel.textContent = "" + timeElapsed;
            }
        }, 16);
    }

    private drawGaussianBlur(srcTexture: WebGLTexture,
                             width: number,
                             height: number,
                             passCount: number):
                             void {
        const gl = this.gl;

        // Horizontal blur
        const renderTarget = this.getRenderTarget(this.canvasTest.width, height);
        const radius = this.radius / Math.pow(2.0, passCount);
        gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget.framebuffer);
        this.drawBlur(radius, this.canvasTest.width, height, width, height, false, srcTexture);
        srcTexture = renderTarget.texture;
        width = this.canvasTest.width;

        // Vertical blur
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.drawBlur(radius,
                      this.canvasTest.width,
                      this.canvasTest.height,
                      width,
                      height,
                      true,
                      srcTexture);
    }

    private drawDualBlur(srcTexture: WebGLTexture,
                         width: number,
                         height: number,
                         passCount: number):
                         void {
        const gl = this.gl;

        let pass = 0;
        while (pass < passCount) {
            const scaleFactor = 2.0;
            const newWidth = width * scaleFactor, newHeight = height * scaleFactor;

            let renderTarget = null;
            if (pass < passCount - 1)
                renderTarget = this.getRenderTarget(newWidth, newHeight);

            const framebuffer = renderTarget != null ? renderTarget.framebuffer : null;
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

            this.drawQuad(this.shaderProgramDualUp,
                          newWidth,
                          newHeight,
                          width,
                          height,
                          srcTexture);

            if (renderTarget != null)
                srcTexture = renderTarget.texture;

            width = newWidth;
            height = newHeight;

            pass++;
        }
    }

    private drawBlur(radius: number,
                     destWidth: number,
                     destHeight: number,
                     srcWidth: number,
                     srcHeight: number,
                     vertical: boolean,
                     srcTexture: WebGLTexture):
                     void {
        const gl = this.gl;

        const sigma = radius * 0.5;
        const coeff = -1.0 / (2.0 * sigma * sigma);

        const shaderProgram = this.shaderProgramBlur;
        gl.bindVertexArray(shaderProgram.vertexArrayObject);
        gl.useProgram(shaderProgram.program);
        gl.uniform1f(shaderProgram.uniformCoeff, coeff);
        gl.uniform1i(shaderProgram.uniformVertical, vertical ? 1 : 0);

        this.drawQuad(shaderProgram, destWidth, destHeight, srcWidth, srcHeight, srcTexture);
    }

    private drawQuad(shaderProgram: ShaderProgram,
                     destWidth: number,
                     destHeight: number,
                     srcWidth: number,
                     srcHeight: number,
                     srcTexture: WebGLTexture):
                     void {
        const gl = this.gl;

        gl.bindVertexArray(shaderProgram.vertexArrayObject);
        gl.useProgram(shaderProgram.program);
        gl.viewport(0, 0, destWidth, destHeight);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTexture);
        gl.uniform1i(shaderProgram.uniformTexture, 0);
        gl.uniform2f(shaderProgram.uniformSrcSize, srcWidth, srcHeight);
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

    private getRenderTarget(width: number, height: number): RenderTarget {
        const key = width + "x" + height;
        if (key in this.renderTargets)
            return this.renderTargets[key];
        const renderTarget = new RenderTarget(this.gl, width, height);
        this.renderTargets[key] = renderTarget;
        return renderTarget;
    }

    private updateMethod(): void {
        this.method = this.methodSelect.selectedIndex == 0 ? 'gaussian' : 'dual';
        this.update();
    }
}

type RenderTargetMap = {[key: string]: RenderTarget};

class RenderTarget {
    framebuffer: WebGLFramebuffer;
    texture: WebGLTexture;

    constructor(gl: WebGLRenderingContext, width: number, height: number) {
        this.texture = unwrap(gl.createTexture());
        this.framebuffer = unwrap(gl.createFramebuffer());
        this.resize(gl, width, height);
    }

    private resize(gl: WebGLRenderingContext, width: number, height: number): void {
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
    vertexArrayObject: WebGLVertexArrayObject;
    uniformTexture: WebGLUniformLocation;
    uniformSrcSize: WebGLUniformLocation | null;
    uniformCoeff: WebGLUniformLocation | null;
    uniformVertical: WebGLUniformLocation | null;

    constructor(gl: WebGL2RenderingContext, fragmentShader: string, vertexBuffer: WebGLBuffer) {
        const shaderVertex = createShader(gl, 'vertex', SHADER_SOURCE_VERTEX);
        const shaderFragment = createShader(gl, 'fragment', fragmentShader);

        const program = unwrap(gl.createProgram());
        gl.attachShader(program, shaderVertex);
        gl.attachShader(program, shaderFragment);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw new Error("Linking failed: " + gl.getProgramInfoLog(program));
        this.program = program;

        this.vertexArrayObject = unwrap(gl.createVertexArray());
        gl.bindVertexArray(this.vertexArrayObject);

        gl.useProgram(program);
        const attribVertexPosition = gl.getAttribLocation(program, "aPosition");
        const attribTexCoord = gl.getAttribLocation(program, "aTexCoord");
        this.uniformTexture = unwrap(gl.getUniformLocation(program, "uTexture"));
        this.uniformSrcSize = gl.getUniformLocation(program, "uSrcSize");
        this.uniformCoeff = gl.getUniformLocation(program, "uCoeff");
        this.uniformVertical = gl.getUniformLocation(program, "uVertical");

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.vertexAttribPointer(attribVertexPosition, 2, gl.BYTE, false, 4, 0);
        gl.vertexAttribPointer(attribTexCoord, 2, gl.BYTE, false, 4, 2);
        gl.enableVertexAttribArray(attribVertexPosition);
        gl.enableVertexAttribArray(attribTexCoord);

        gl.bindVertexArray(null);
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
