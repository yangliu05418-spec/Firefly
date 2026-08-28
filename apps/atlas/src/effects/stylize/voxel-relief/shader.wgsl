// Voxel Relief - brightness-driven block extrusion with temporal feedback.

struct VoxelReliefParams {
  columns: f32,
  heightScale: f32,
  baseHeight: f32,
  gap: f32,
  tilt: f32,
  yaw: f32,
  perspective: f32,
  heightContrast: f32,
  ambient: f32,
  lightStrength: f32,
  temporalBlend: f32,
  colorMix: f32,
  width: f32,
  height: f32,
  maxSteps: f32,
  reset: f32,
  lightAngle: f32,
  lightElevation: f32,
  floorBrightness: f32,
  edgeDarkness: f32,
};

struct VoxelCell {
  center: vec2f,
  halfSize: vec3f,
  height: f32,
  color: vec4f,
  material: f32,
};

struct VoxelMapSample {
  dist: f32,
  cell: VoxelCell,
};

struct VoxelRay {
  origin: vec3f,
  direction: vec3f,
};

struct VoxelHit {
  hit: f32,
  position: vec3f,
  travel: f32,
  sample: VoxelMapSample,
};

struct VoxelScreenCell {
  center: vec2f,
  local: vec2f,
  color: vec4f,
  blockHeight: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: VoxelReliefParams;
@group(0) @binding(3) var feedbackTex: texture_2d<f32>;

fn voxelFieldSize() -> vec2f {
  let aspect = max(params.width / max(params.height, 1.0), 0.1);
  return vec2f(aspect, 1.0);
}

fn voxelCellSize(fieldSize: vec2f) -> f32 {
  return fieldSize.x / clamp(params.columns, 4.0, 240.0);
}

fn voxelSdBox(p: vec3f, halfSize: vec3f) -> f32 {
  let q = abs(p) - halfSize;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn voxelRadians(degrees: f32) -> f32 {
  return degrees * PI / 180.0;
}

fn voxelEmptyCell() -> VoxelCell {
  var cell: VoxelCell;
  cell.center = vec2f(0.0);
  cell.halfSize = vec3f(0.0);
  cell.height = 0.0;
  cell.color = vec4f(0.0);
  cell.material = 0.0;
  return cell;
}

fn voxelScreenCellSize() -> vec2f {
  let aspect = max(params.width / max(params.height, 1.0), 0.1);
  let cellX = 1.0 / clamp(params.columns, 4.0, 240.0);
  return vec2f(cellX, cellX * aspect);
}

fn voxelHeightFromColor(color: vec4f) -> f32 {
  let brightness = pow(clamp(luminance(color.rgb), 0.0, 1.0), max(params.heightContrast, 0.001));
  return max(params.baseHeight, 0.0) * color.a + brightness * max(params.heightScale, 0.0) * color.a;
}

fn voxelSampleScreenCell(uv: vec2f, offset: vec2f) -> VoxelScreenCell {
  let cellSize = voxelScreenCellSize();
  let cellIndex = floor(uv / cellSize) + offset;
  let center = (cellIndex + vec2f(0.5)) * cellSize;
  let sampleUv = clamp(center, vec2f(0.0), vec2f(1.0));
  let color = textureSampleLevel(inputTex, texSampler, sampleUv, 0.0);

  var cell: VoxelScreenCell;
  cell.center = center;
  cell.local = fract(uv / cellSize);
  cell.color = color;
  cell.blockHeight = voxelHeightFromColor(color);
  return cell;
}

fn voxelScreenRelief(uv: vec2f) -> vec4f {
  let cell = voxelSampleScreenCell(uv, vec2f(0.0));
  let rightCell = voxelSampleScreenCell(uv, vec2f(1.0, 0.0));
  let downCell = voxelSampleScreenCell(uv, vec2f(0.0, 1.0));
  let leftCell = voxelSampleScreenCell(uv, vec2f(-1.0, 0.0));
  let upCell = voxelSampleScreenCell(uv, vec2f(0.0, -1.0));

  let maxHeight = max(params.baseHeight + params.heightScale, 0.001);
  let height01 = clamp(cell.blockHeight / maxHeight, 0.0, 1.0);
  let viewSlant = clamp((90.0 - clamp(params.tilt, 20.0, 88.0)) / 35.0, 0.0, 1.0);
  let perspectiveAmount = clamp((params.perspective - 0.15) / 1.45, 0.0, 1.0);
  let heightAmount = clamp(params.heightScale / 0.24, 0.0, 3.0);
  let yawBias = clamp(params.yaw / 45.0, -1.0, 1.0);
  let sideWidth = clamp((0.075 + viewSlant * 0.18 + perspectiveAmount * 0.13) * heightAmount, 0.04, 0.42);
  let gap = clamp(params.gap, 0.0, 0.42);
  let bevel = clamp(0.036 + gap * 0.24, 0.026, 0.16);
  let edgeDistance = max(abs(cell.local.x - 0.5), abs(cell.local.y - 0.5)) * 2.0;
  let gridLine = smoothstep(1.0 - bevel, 1.0, edgeDistance);

  let lightAzimuth = voxelRadians(params.lightAngle);
  let lightElevation = voxelRadians(clamp(params.lightElevation, 1.0, 89.0));
  let lightDir = normalize(vec3f(
    cos(lightAzimuth) * cos(lightElevation),
    -sin(lightAzimuth) * cos(lightElevation),
    sin(lightElevation)
  ));

  let topDiffuse = max(dot(vec3f(0.0, 0.0, 1.0), lightDir), 0.0);
  let topLight = clamp(params.ambient + topDiffuse * params.lightStrength, 0.0, 2.0);
  let sourceRgb = mix(vec3f(luminance(cell.color.rgb)), cell.color.rgb, clamp(params.colorMix, 0.0, 1.0));
  var rgb = sourceRgb * topLight;

  let rightDrop = clamp((cell.blockHeight - rightCell.blockHeight) / maxHeight, 0.0, 1.0);
  let downDrop = clamp((cell.blockHeight - downCell.blockHeight) / maxHeight, 0.0, 1.0);
  let leftRise = clamp((leftCell.blockHeight - cell.blockHeight) / maxHeight, 0.0, 1.0);
  let upRise = clamp((upCell.blockHeight - cell.blockHeight) / maxHeight, 0.0, 1.0);
  let leftDrop = clamp((cell.blockHeight - leftCell.blockHeight) / maxHeight, 0.0, 1.0);
  let rightRise = clamp((rightCell.blockHeight - cell.blockHeight) / maxHeight, 0.0, 1.0);

  let rightVisibility = clamp(0.5 + yawBias * 0.5, 0.0, 1.0);
  let leftVisibility = 1.0 - rightVisibility;
  let rightSideStrength = max(rightDrop, height01 * 0.28);
  let leftSideStrength = max(leftDrop, height01 * 0.14);
  let downSideStrength = max(downDrop, height01 * 0.34);
  let rightSide = smoothstep(1.0 - sideWidth, 1.0, cell.local.x) * rightSideStrength * mix(0.35, 1.0, rightVisibility);
  let leftSide = (1.0 - smoothstep(0.0, sideWidth, cell.local.x)) * leftSideStrength * mix(0.35, 1.0, leftVisibility);
  let downSide = smoothstep(1.0 - sideWidth, 1.0, cell.local.y) * downSideStrength;
  let shadowWidth = clamp(sideWidth * 1.45, 0.02, 0.38);
  let occlusion = (1.0 - smoothstep(0.0, shadowWidth, cell.local.x)) * leftRise * mix(0.35, 1.0, rightVisibility) +
    smoothstep(1.0 - shadowWidth, 1.0, cell.local.x) * rightRise * mix(0.35, 1.0, leftVisibility) +
    (1.0 - smoothstep(0.0, shadowWidth, cell.local.y)) * upRise;

  let sideNormalX = vec3f(1.0, 0.0, 0.22);
  let sideNormalY = vec3f(0.0, 1.0, 0.22);
  let sideLightX = clamp(params.ambient * 0.58 + max(dot(normalize(sideNormalX), lightDir), 0.0) * params.lightStrength, 0.08, 1.2);
  let sideLightY = clamp(params.ambient * 0.5 + max(dot(normalize(sideNormalY), lightDir), 0.0) * params.lightStrength, 0.06, 1.1);
  let horizontalSide = max(rightSide, leftSide);
  let sideShade = min(mix(1.0, sideLightX, horizontalSide), mix(1.0, sideLightY, downSide));
  let sideMask = clamp(max(horizontalSide, downSide), 0.0, 1.0);
  let sideRgb = sourceRgb * sideShade * mix(0.62, 0.32, clamp(params.edgeDarkness, 0.0, 1.0));

  rgb = mix(rgb, sideRgb, sideMask);
  rgb *= 1.0 - clamp(occlusion, 0.0, 1.0) * clamp(params.edgeDarkness, 0.0, 1.0) * 0.58;
  rgb *= 1.0 - gridLine * clamp(params.edgeDarkness, 0.0, 1.0) * 0.72;
  rgb += vec3f(height01 * 0.045);

  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), cell.color.a);
}

fn voxelScreenPixelColor(uv: vec2f) -> vec4f {
  let aspect = max(params.width / max(params.height, 1.0), 0.1);
  let columns = clamp(params.columns, 4.0, 240.0);
  let cellX = 1.0 / columns;
  let cellY = cellX * aspect;
  let cell = vec2f(cellX, cellY);
  let center = (floor(uv / cell) + vec2f(0.5)) * cell;
  let source = textureSampleLevel(inputTex, texSampler, clamp(center, vec2f(0.0), vec2f(1.0)), 0.0);
  let local = abs(fract(uv / cell) - vec2f(0.5)) * 2.0;
  let grid = smoothstep(0.86, 1.0, max(local.x, local.y));
  let edgeShade = 1.0 - grid * clamp(params.edgeDarkness, 0.0, 1.0) * 0.42;
  return vec4f(source.rgb * edgeShade * clamp(params.floorBrightness, 0.0, 1.0), source.a);
}

fn voxelGapColor(uv: vec2f) -> vec4f {
  let source = textureSampleLevel(inputTex, texSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
  let gapLight = clamp(params.floorBrightness, 0.0, 1.0) * 0.32;
  return vec4f(source.rgb * gapLight, source.a);
}

fn voxelFloorCell(fieldSize: vec2f, p: vec3f) -> VoxelCell {
  let uv = clamp(p.xy / fieldSize, vec2f(0.0), vec2f(1.0));
  var cell: VoxelCell;
  cell.center = fieldSize * 0.5;
  cell.halfSize = vec3f(fieldSize * 0.5, 0.018);
  cell.height = 0.0;
  cell.color = textureSampleLevel(inputTex, texSampler, uv, 0.0);
  cell.material = 0.0;
  return cell;
}

fn voxelCellFromIndex(index: vec2f, fieldSize: vec2f, cellSize: f32) -> VoxelCell {
  let center = (index + vec2f(0.5)) * cellSize;
  let uv = center / fieldSize;
  let source = textureSampleLevel(inputTex, texSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
  let brightness = pow(clamp(luminance(source.rgb), 0.0, 1.0), max(params.heightContrast, 0.001));
  let height = max(params.baseHeight, 0.0) * source.a + brightness * max(params.heightScale, 0.0) * source.a;
  let fill = clamp(1.0 - params.gap, 0.18, 1.0);

  var cell: VoxelCell;
  cell.center = center;
  cell.halfSize = vec3f(vec2f(cellSize * 0.5 * fill), max(height * 0.5, 0.0005));
  cell.height = max(height, 0.001);
  cell.color = source;
  cell.material = 1.0;
  return cell;
}

fn voxelMap(p: vec3f) -> VoxelMapSample {
  let fieldSize = voxelFieldSize();
  let cellSize = voxelCellSize(fieldSize);

  var best: VoxelMapSample;
  best.dist = 1.0e6;
  best.cell = voxelEmptyCell();

  let baseIndex = floor(p.xy / cellSize);
  for (var offsetY = -1; offsetY <= 1; offsetY = offsetY + 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX = offsetX + 1) {
      let index = baseIndex + vec2f(f32(offsetX), f32(offsetY));
      let cell = voxelCellFromIndex(index, fieldSize, cellSize);
      let boxCenter = vec3f(cell.center, cell.height * 0.5);
      let dist = voxelSdBox(p - boxCenter, cell.halfSize);
      if (dist < best.dist) {
        best.dist = dist;
        best.cell = cell;
      }
    }
  }

  return best;
}

fn voxelCameraRay(uv: vec2f) -> VoxelRay {
  let fieldSize = voxelFieldSize();
  let focusPoint = vec3f(fieldSize.x * 0.5, 0.5, 0.0);
  let viewAngle = voxelRadians(90.0 - clamp(params.tilt, 20.0, 88.0));
  let yaw = voxelRadians(params.yaw);
  let perspective = clamp(params.perspective, 0.15, 1.6);
  let fov = voxelRadians(mix(12.0, 42.0, (perspective - 0.15) / 1.45));
  let focal = 1.0 / tan(fov * 0.5);
  let distance = max(0.9, focal * 0.5 + max(params.heightScale + params.baseHeight, 0.0) * 0.7);
  let lateral = tan(viewAngle) * distance;

  let eyeOffset = vec3f(
    sin(yaw) * lateral,
    -cos(yaw) * lateral,
    distance
  );
  let eye = focusPoint + eyeOffset;
  let forward = normalize(focusPoint - eye);
  let worldUp = vec3f(0.0, -1.0, 0.0);
  let right = normalize(cross(forward, worldUp));
  let up = normalize(cross(right, forward));

  let screenAspect = max(params.width / max(params.height, 1.0), 0.1);
  let screen = vec2f((uv.x * 2.0 - 1.0) * screenAspect, 1.0 - uv.y * 2.0);
  let direction = normalize(forward * focal + right * screen.x + up * screen.y);

  var ray: VoxelRay;
  ray.origin = eye;
  ray.direction = direction;
  return ray;
}

fn voxelTrace(ray: VoxelRay) -> VoxelHit {
  var hit: VoxelHit;
  hit.hit = 0.0;
  hit.position = ray.origin;
  hit.travel = 0.0;
  hit.sample.dist = 1.0e6;
  hit.sample.cell = voxelEmptyCell();

  let maxSteps = i32(clamp(params.maxSteps, 16.0, 144.0));
  let maxDistance = 8.0;
  var travel = 0.0;

  for (var stepIndex = 0; stepIndex < 144; stepIndex = stepIndex + 1) {
    if (stepIndex >= maxSteps) {
      break;
    }

    let position = ray.origin + ray.direction * travel;
    let sample = voxelMap(position);
    let epsilon = 0.0008 + travel * 0.00035;

    if (sample.dist < epsilon) {
      hit.hit = 1.0;
      hit.position = position;
      hit.travel = travel;
      hit.sample = sample;
      break;
    }

    travel += clamp(sample.dist * 0.82, 0.002, 0.085);
    if (travel > maxDistance || position.z < -0.15) {
      break;
    }
  }

  return hit;
}

fn voxelFaceNormal(hit: VoxelHit) -> vec3f {
  if (hit.sample.cell.material < 0.5) {
    return vec3f(0.0, 0.0, 1.0);
  }

  let cell = hit.sample.cell;
  let local = hit.position - vec3f(cell.center, cell.height * 0.5);
  let halfSize = max(cell.halfSize, vec3f(0.0001));
  let faceDistance = abs(abs(local) - halfSize);

  if (faceDistance.z <= faceDistance.x && faceDistance.z <= faceDistance.y && local.z > 0.0) {
    return vec3f(0.0, 0.0, 1.0);
  }

  if (faceDistance.x < faceDistance.y) {
    return vec3f(select(-1.0, 1.0, local.x >= 0.0), 0.0, 0.0);
  }

  return vec3f(0.0, select(-1.0, 1.0, local.y >= 0.0), 0.0);
}

fn voxelShade(hit: VoxelHit, ray: VoxelRay, fallbackUv: vec2f) -> vec4f {
  if (hit.hit < 0.5) {
    return voxelGapColor(fallbackUv);
  }

  let normal = voxelFaceNormal(hit);
  let source = hit.sample.cell.color;
  let lightAzimuth = voxelRadians(params.lightAngle);
  let lightElevation = voxelRadians(clamp(params.lightElevation, 1.0, 89.0));
  let lightDir = normalize(vec3f(
    cos(lightAzimuth) * cos(lightElevation),
    -sin(lightAzimuth) * cos(lightElevation),
    sin(lightElevation)
  ));

  let diffuse = max(dot(normal, lightDir), 0.0);
  let halfVector = normalize(lightDir - ray.direction);
  let specular = pow(max(dot(normal, halfVector), 0.0), 30.0) * 0.06;
  let topness = abs(normal.z);
  let faceBias = mix(0.68, 1.08, topness);
  let light = (clamp(params.ambient, 0.0, 1.5) + diffuse * max(params.lightStrength, 0.0)) * faceBias;

  var color = mix(vec3f(luminance(source.rgb)), source.rgb, clamp(params.colorMix, 0.0, 1.0));

  if (hit.sample.cell.material < 0.5) {
    color *= clamp(params.floorBrightness, 0.0, 1.0);
  } else {
    let edgeLocal = abs(hit.position.xy - hit.sample.cell.center) / max(hit.sample.cell.halfSize.xy, vec2f(0.0001));
    let edge = smoothstep(0.78, 1.0, max(edgeLocal.x, edgeLocal.y));
    let edgeShade = 1.0 - edge * clamp(params.edgeDarkness, 0.0, 1.0) * 0.36;
    let heightLift = smoothstep(0.0, max(params.heightScale + params.baseHeight, 0.001), hit.sample.cell.height) * 0.12;
    color = color * edgeShade + vec3f(heightLift);
  }

  let shaded = clamp(color * light + vec3f(specular), vec3f(0.0), vec3f(1.0));
  return vec4f(shaded, source.a);
}

@fragment
fn voxelReliefFragment(input: VertexOutput) -> @location(0) vec4f {
  let ray = voxelCameraRay(input.uv);
  let hit = voxelTrace(ray);
  let relief = voxelShade(hit, ray, input.uv);
  let previous = textureSampleLevel(feedbackTex, texSampler, input.uv, 0.0);
  let smoothing = select(clamp(params.temporalBlend, 0.0, 0.94), 0.0, params.reset > 0.5);
  let rgb = mix(relief.rgb, previous.rgb, smoothing);
  let alpha = max(relief.a, previous.a * smoothing);
  return vec4f(rgb, alpha);
}
