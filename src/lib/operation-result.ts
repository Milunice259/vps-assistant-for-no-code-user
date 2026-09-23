export type OperationRisk = "safe" | "caution" | "danger";

export type OperationResult = {
  message: string;
  risk: OperationRisk;
  verified: boolean;
  rollback?: string;
  output?: string;
};

export function operationResult(result: OperationResult): OperationResult {
  return result;
}
