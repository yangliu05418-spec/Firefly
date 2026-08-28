export function lookAt(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  upX: number,
  upY: number,
  upZ: number,
): Float32Array {
  let fX = eyeX - targetX;
  let fY = eyeY - targetY;
  let fZ = eyeZ - targetZ;
  let len = Math.hypot(fX, fY, fZ);
  if (len > 0) {
    fX /= len;
    fY /= len;
    fZ /= len;
  }

  let rX = upY * fZ - upZ * fY;
  let rY = upZ * fX - upX * fZ;
  let rZ = upX * fY - upY * fX;
  len = Math.hypot(rX, rY, rZ);
  if (len > 0) {
    rX /= len;
    rY /= len;
    rZ /= len;
  }

  const uX = fY * rZ - fZ * rY;
  const uY = fZ * rX - fX * rZ;
  const uZ = fX * rY - fY * rX;

  const matrix = new Float32Array(16);
  matrix[0] = rX;
  matrix[1] = uX;
  matrix[2] = fX;
  matrix[3] = 0;
  matrix[4] = rY;
  matrix[5] = uY;
  matrix[6] = fY;
  matrix[7] = 0;
  matrix[8] = rZ;
  matrix[9] = uZ;
  matrix[10] = fZ;
  matrix[11] = 0;
  matrix[12] = -(rX * eyeX + rY * eyeY + rZ * eyeZ);
  matrix[13] = -(uX * eyeX + uY * eyeY + uZ * eyeZ);
  matrix[14] = -(fX * eyeX + fY * eyeY + fZ * eyeZ);
  matrix[15] = 1;
  return matrix;
}

export function perspective(fovYRadians: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovYRadians * 0.5);
  const rangeInv = 1 / (near - far);
  const matrix = new Float32Array(16);
  matrix[0] = f / aspect;
  matrix[5] = f;
  matrix[10] = far * rangeInv;
  matrix[11] = -1;
  matrix[14] = near * far * rangeInv;
  return matrix;
}

export function orthographic(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Float32Array {
  const matrix = new Float32Array(16);
  matrix[0] = 2 / (right - left);
  matrix[5] = 2 / (top - bottom);
  matrix[10] = 1 / (near - far);
  matrix[12] = (left + right) / (left - right);
  matrix[13] = (bottom + top) / (bottom - top);
  matrix[14] = near / (near - far);
  matrix[15] = 1;
  return matrix;
}
