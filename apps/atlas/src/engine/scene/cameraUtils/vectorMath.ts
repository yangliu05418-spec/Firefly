export type CameraVector3 = { x: number; y: number; z: number };
export type CameraQuaternion = { x: number; y: number; z: number; w: number };

export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVector(a: CameraVector3, b: CameraVector3, t: number): CameraVector3 {
  return {
    x: lerpNumber(a.x, b.x, t),
    y: lerpNumber(a.y, b.y, t),
    z: lerpNumber(a.z, b.z, t),
  };
}

export function scaleVector(v: CameraVector3, scale: number): CameraVector3 {
  return { x: v.x * scale, y: v.y * scale, z: v.z * scale };
}

export function addVector(a: CameraVector3, b: CameraVector3): CameraVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtractVector(a: CameraVector3, b: CameraVector3): CameraVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function crossVector(a: CameraVector3, b: CameraVector3): CameraVector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function dotVector(a: CameraVector3, b: CameraVector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function normalizeVector(v: CameraVector3, fallback: CameraVector3): CameraVector3 {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length <= 1e-8) {
    return { ...fallback };
  }

  return {
    x: v.x / length,
    y: v.y / length,
    z: v.z / length,
  };
}

export function rotateVectorAroundAxis(v: CameraVector3, axis: CameraVector3, degrees: number): CameraVector3 {
  if (!Number.isFinite(degrees) || Math.abs(degrees) <= 1e-8) {
    return { ...v };
  }

  const rad = (degrees * Math.PI) / 180;
  const unitAxis = normalizeVector(axis, { x: 0, y: 1, z: 0 });
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cross = crossVector(unitAxis, v);
  const dot = dotVector(unitAxis, v);

  return {
    x: v.x * cos + cross.x * sin + unitAxis.x * dot * (1 - cos),
    y: v.y * cos + cross.y * sin + unitAxis.y * dot * (1 - cos),
    z: v.z * cos + cross.z * sin + unitAxis.z * dot * (1 - cos),
  };
}

export function normalizeQuaternion(q: CameraQuaternion): CameraQuaternion {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length <= 1e-8) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return {
    x: q.x / length,
    y: q.y / length,
    z: q.z / length,
    w: q.w / length,
  };
}

export function quaternionFromCameraBasis(
  right: CameraVector3,
  up: CameraVector3,
  forward: CameraVector3,
): CameraQuaternion {
  const back = scaleVector(forward, -1);
  const m00 = right.x;
  const m01 = up.x;
  const m02 = back.x;
  const m10 = right.y;
  const m11 = up.y;
  const m12 = back.y;
  const m20 = right.z;
  const m21 = up.z;
  const m22 = back.z;
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    return normalizeQuaternion({
      w: 0.25 * scale,
      x: (m21 - m12) / scale,
      y: (m02 - m20) / scale,
      z: (m10 - m01) / scale,
    });
  }

  if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalizeQuaternion({
      w: (m21 - m12) / scale,
      x: 0.25 * scale,
      y: (m01 + m10) / scale,
      z: (m02 + m20) / scale,
    });
  }

  if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalizeQuaternion({
      w: (m02 - m20) / scale,
      x: (m01 + m10) / scale,
      y: 0.25 * scale,
      z: (m12 + m21) / scale,
    });
  }

  const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalizeQuaternion({
    w: (m10 - m01) / scale,
    x: (m02 + m20) / scale,
    y: (m12 + m21) / scale,
    z: 0.25 * scale,
  });
}

export function slerpQuaternion(a: CameraQuaternion, b: CameraQuaternion, t: number): CameraQuaternion {
  let next = b;
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

  if (dot < 0) {
    dot = -dot;
    next = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }

  if (dot > 0.9995) {
    return normalizeQuaternion({
      x: lerpNumber(a.x, next.x, t),
      y: lerpNumber(a.y, next.y, t),
      z: lerpNumber(a.z, next.z, t),
      w: lerpNumber(a.w, next.w, t),
    });
  }

  const theta0 = Math.acos(Math.max(-1, Math.min(1, dot)));
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
  const s1 = sinTheta / sinTheta0;

  return normalizeQuaternion({
    x: a.x * s0 + next.x * s1,
    y: a.y * s0 + next.y * s1,
    z: a.z * s0 + next.z * s1,
    w: a.w * s0 + next.w * s1,
  });
}

export function rotateVectorByQuaternion(v: CameraVector3, q: CameraQuaternion): CameraVector3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);

  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}
