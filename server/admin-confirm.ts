export const validateAdminWrite = (input: { target?: string; confirmation?: string; operator?: string }) => {
  if (!input.target) throw new Error("缺少 --task <taskId>");
  const operator = input.operator?.trim() ?? "";
  if (!operator || operator.length > 128) throw new Error("写操作必须设置 FIREFLY_OPERATOR");
  if (input.confirmation !== input.target) throw new Error(`写操作必须附带 --confirm ${input.target}`);
  return { target: input.target, operator };
};
