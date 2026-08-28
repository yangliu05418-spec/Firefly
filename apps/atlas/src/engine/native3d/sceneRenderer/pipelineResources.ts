import compositeShaderSource from '../shaders/SceneTextureComposite.wgsl?raw';
import planeShaderSource from '../shaders/PlanePass.wgsl?raw';
import {
  SCENE_COLOR_FORMAT,
  SCENE_DEPTH_FORMAT,
} from './constants';

export interface CompositeResources {
  pipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  sampler: GPUSampler;
}

export interface PlaneResources {
  opaquePipeline: GPURenderPipeline;
  transparentPipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  sampler: GPUSampler;
}

export interface PlaneWhiteMaskResource {
  whiteMaskTexture: GPUTexture;
  whiteMaskView: GPUTextureView;
}

export function createCompositeResources(device: GPUDevice): CompositeResources {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
    label: 'native-scene-composite-bind-group-layout',
  });

  const shaderModule = device.createShaderModule({
    code: compositeShaderSource,
    label: 'native-scene-composite-shader',
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
      label: 'native-scene-composite-pipeline-layout',
    }),
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [
        {
          format: SCENE_COLOR_FORMAT,
          blend: {
            color: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
    label: 'native-scene-composite-pipeline',
  });

  return {
    pipeline,
    bindGroupLayout,
    sampler: device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    }),
  };
}

export function createPlaneResources(device: GPUDevice): PlaneResources {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
    label: 'native-scene-plane-bind-group-layout',
  });

  const shaderModule = device.createShaderModule({
    code: planeShaderSource,
    label: 'native-scene-plane-shader',
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
    label: 'native-scene-plane-pipeline-layout',
  });

  const opaquePipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [
        {
          format: SCENE_COLOR_FORMAT,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none',
    },
    depthStencil: {
      format: SCENE_DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
    },
    label: 'native-scene-plane-opaque-pipeline',
  });

  const transparentPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [
        {
          format: SCENE_COLOR_FORMAT,
          blend: {
            color: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none',
    },
    depthStencil: {
      format: SCENE_DEPTH_FORMAT,
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
    },
    label: 'native-scene-plane-transparent-pipeline',
  });

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  return {
    opaquePipeline,
    transparentPipeline,
    bindGroupLayout,
    sampler,
  };
}

export function createPlaneWhiteMaskResource(device: GPUDevice): PlaneWhiteMaskResource {
  const whiteMaskTexture = device.createTexture({
    size: { width: 1, height: 1 },
    format: SCENE_COLOR_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
    label: 'native-scene-plane-white-mask-texture',
  });

  return {
    whiteMaskTexture,
    whiteMaskView: whiteMaskTexture.createView(),
  };
}
