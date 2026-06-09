/**
 * 将未知类型的错误转换为可读的错误字符串。
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
